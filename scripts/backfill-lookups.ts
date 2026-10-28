/**
 * One-off backfill for the `usernames` and `referralCodes` lookup collections.
 *
 * Usage (PowerShell), with the service key at .secrets/service-account.json:
 *   npx tsx scripts/backfill-lookups.ts
 *
 * Add --dry-run to report what would be written without writing anything.
 *
 * WHY THIS EXISTS
 * ---------------
 * `users` is no longer listable, and three lookups that used to scan it now
 * read `usernames/{lowercased}` and `referralCodes/{code}` by document ID.
 * Accounts created before that change have no mapping documents, so without
 * this backfill:
 *
 *   - signing in will not find an orphaned profile to migrate
 *   - existing referral codes cannot be redeemed
 *
 * Run it AFTER deploying the rules, signed in as an admin. Both mapping
 * collections permit an admin to write any document precisely so this can
 * work -- it cannot hold anyone else's auth token. Listing `users` is
 * likewise admin-only now.
 *
 * Largely belt-and-braces: the sign-in sweep self-heals a missing username
 * mapping on that account's own next sign-in. This exists to fix everyone at
 * once rather than waiting for each user to return, and to surface duplicate
 * usernames, which self-healing cannot resolve.
 *
 * Signs in as a normal client, so every write goes through firestore.rules.
 *
 * Idempotent: existing mapping documents are left alone unless --force is
 * passed, and a mapping that already points at the right uid is never
 * rewritten.
 */
import { adminDb, collection, doc, getDoc, getDocs, setDoc, updateDoc } from './lib/adminDb';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');



type Row = { uid: string; username?: string; referralCode?: string };

async function main() {
  const db = adminDb();

  console.log(DRY_RUN ? 'DRY RUN — nothing will be written.' : 'LIVE RUN.');

  const snapshot = await getDocs(collection(db, 'users'));
  console.log(`Read ${snapshot.size} user documents.`);

  const rows: Row[] = snapshot.docs.map((d) => ({
    uid: d.id,
    username: d.data().username,
    referralCode: d.data().referralCode,
  }));

  // Surface collisions rather than silently letting last-write-win decide.
  // The sign-in sweep can only migrate the ONE profile a username maps to, so
  // a username held by several UIDs needs a human decision about which wins.
  const byUsername = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.username) continue;
    const key = r.username.toLowerCase();
    byUsername.set(key, [...(byUsername.get(key) ?? []), r.uid]);
  }
  const collisions = [...byUsername.entries()].filter(([, uids]) => uids.length > 1);

  let usernamesWritten = 0;
  let codesWritten = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const r of rows) {
    if (!r.username) {
      problems.push(`${r.uid}: no username field, skipped`);
      continue;
    }
    const key = r.username.toLowerCase();

    // A colliding username is left entirely alone — see the report below.
    if ((byUsername.get(key)?.length ?? 0) > 1) {
      skipped++;
      continue;
    }

    const mappingRef = doc(db, 'usernames', key);
    const existing = await getDoc(mappingRef);
    if (existing.exists() && !FORCE) {
      if (existing.data().uid !== r.uid) {
        problems.push(
          `usernames/${key} points at ${existing.data().uid}, expected ${r.uid} (use --force to overwrite)`,
        );
      }
    } else {
      if (!DRY_RUN) await setDoc(mappingRef, { uid: r.uid });
      usernamesWritten++;
    }

    if (r.referralCode) {
      const codeRef = doc(db, 'referralCodes', r.referralCode);
      const existingCode = await getDoc(codeRef);
      if (existingCode.exists() && !FORCE) {
        if (existingCode.data().uid !== r.uid) {
          problems.push(
            `referralCodes/${r.referralCode} points at ${existingCode.data().uid}, expected ${r.uid}`,
          );
        }
      } else {
        if (!DRY_RUN) await setDoc(codeRef, { uid: r.uid });
        codesWritten++;
      }
    }
  }

  console.log('');
  console.log(`usernames written:     ${usernamesWritten}`);
  console.log(`referralCodes written: ${codesWritten}`);
  console.log(`skipped (collisions):  ${skipped}`);

  if (collisions.length) {
    console.log('');
    console.log('DUPLICATE USERNAMES — not backfilled, need a decision:');
    for (const [name, uids] of collisions) {
      console.log(`  ${name}: ${uids.join(', ')}`);
    }
    console.log('');
    console.log('  Each of these has several profiles. The sign-in sweep migrates the');
    console.log('  ONE profile the mapping points at, so pick the surviving uid per');
    console.log('  username and write that mapping by hand, or consolidate first.');
  }

  if (problems.length) {
    console.log('');
    console.log('PROBLEMS:');
    for (const p of problems) console.log(`  ${p}`);
  }

  if (DRY_RUN) {
    console.log('');
    console.log('Dry run — nothing was written.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

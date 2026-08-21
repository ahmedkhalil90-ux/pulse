/**
 * One-off migration: groups.members array -> groups/{id}/members/{uid}
 * subcollection, plus a memberCount field.
 *
 * Usage (PowerShell):
 *   $env:PULSE_USERNAME = "yourhandle"
 *   $env:PULSE_PASSWORD = "yourpassword"
 *   npx tsx scripts/migrate-group-members.ts --dry-run
 *   npx tsx scripts/migrate-group-members.ts
 *
 * RUN ORDER: deploy the rules FIRST, then run this, then deploy the client.
 *
 * It cannot run before the rules deploy -- the members subcollection has no
 * match block in the old rules, so every write default-denies. It writes
 * membership documents on behalf of other users, which only an admin may do,
 * and that exception only exists in the new rules.
 *
 * Between the rules deploy and this script, joining a group is briefly broken
 * for groups that predate the change: memberCount will not match a roster that
 * does not exist yet. Keep the window short.
 *
 * Signs in as an admin, because it has to read every group and write
 * membership documents it does not own.
 *
 * Idempotent: a membership document that already exists is left alone, and
 * memberCount is recomputed from the array each time.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const DRY_RUN = process.argv.includes('--dry-run');
const username = process.env.PULSE_USERNAME;
const password = process.env.PULSE_PASSWORD;

if (!username || !password) {
  console.error('Set PULSE_USERNAME and PULSE_PASSWORD in the environment.');
  process.exit(1);
}

async function main() {
  const app = initializeApp(firebaseConfig as Record<string, string>);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, `${username!.toLowerCase()}@pulse.app`, password!);
  console.log(`Signed in as ${username}.${DRY_RUN ? ' DRY RUN — nothing will be written.' : ''}`);

  const groups = await getDocs(collection(db, 'groups'));
  console.log(`Found ${groups.size} groups.`);

  let membershipsWritten = 0;
  let countsWritten = 0;
  const problems: string[] = [];

  for (const g of groups.docs) {
    const data = g.data();
    const members: string[] = Array.isArray(data.members) ? data.members : [];

    if (!members.length) {
      // Either already migrated, or genuinely empty. Distinguish the two so an
      // already-migrated group is not reported as broken.
      const existing = await getDocs(collection(db, 'groups', g.id, 'members'));
      if (existing.size === 0) {
        problems.push(`${g.id} (${data.name}): no members array and no membership documents`);
      }
      continue;
    }

    for (const uid of members) {
      const ref = doc(db, 'groups', g.id, 'members', uid);
      const existing = await getDoc(ref);
      if (existing.exists()) continue;
      if (!DRY_RUN) {
        await setDoc(ref, {
          uid,
          joinedAt: data.createdAt ?? new Date().toISOString(),
        });
      }
      membershipsWritten++;
    }

    if (data.memberCount !== members.length) {
      if (!DRY_RUN) {
        await updateDoc(doc(db, 'groups', g.id), { memberCount: members.length });
      }
      countsWritten++;
    }
  }

  console.log('');
  console.log(`membership documents written: ${membershipsWritten}`);
  console.log(`memberCount fields written:   ${countsWritten}`);

  if (problems.length) {
    console.log('');
    console.log('NEEDS A LOOK:');
    for (const p of problems) console.log(`  ${p}`);
  }

  console.log('');
  console.log(
    DRY_RUN
      ? 'Dry run — nothing was written.'
      : 'Done. The `members` array is now redundant; leave it in place until the ' +
        'new client is deployed, then remove it at your leisure.',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

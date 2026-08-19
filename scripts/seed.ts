/**
 * One-off loader for the 210 Pulse Originals in src/pulse_seed_questions.json.
 *
 * Usage (PowerShell):
 *   $env:PULSE_USERNAME = "yourhandle"
 *   $env:PULSE_PASSWORD = "yourpassword"
 *   npx tsx scripts/seed.ts
 *
 * Add --dry-run to report what would be written without writing anything.
 *
 * Credentials are read from the environment and never written to disk or
 * logged. The script signs in as a normal user, so every write goes through
 * firestore.rules exactly as the app would.
 *
 * Idempotent: each seed question gets the deterministic document ID
 * `seed_<id>`, so re-running skips what already exists rather than creating
 * duplicates.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, getFirestore, writeBatch } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import seedData from '../src/pulse_seed_questions.json';

type SeedQuestion = {
  id: number;
  category: string;
  question: string;
  option_a: string;
  option_b: string;
};

const SYSTEM_UID = 'pulse_originals_system';
const COLLECTION = 'questions';
const EXISTS_CHUNK = 50;  // parallel getDoc reads
const WRITE_CHUNK = 400;  // Firestore caps a batch at 500 operations

const dryRun = process.argv.includes('--dry-run');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Set PULSE_USERNAME and PULSE_PASSWORD before running.`);
    process.exit(1);
  }
  return value;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  const username = requireEnv('PULSE_USERNAME');
  const password = requireEnv('PULSE_PASSWORD');

  const questions: SeedQuestion[] = seedData.questions;
  console.log(`Loaded ${questions.length} seed questions from src/pulse_seed_questions.json`);

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  const auth = getAuth(app);

  // The app authenticates with a synthetic address; mirror that here.
  const email = `${username.toLowerCase()}@pulse.app`;
  const credential = await signInWithEmailAndPassword(auth, email, password);
  console.log(`Signed in as ${username} (uid ${credential.user.uid})`);
  console.log(`Project: ${firebaseConfig.projectId}, database: ${firebaseConfig.firestoreDatabaseId}`);

  // Existence check by document ID. `questions` allows unconditional single-doc
  // reads, so this needs no composite index and no list permission.
  const present = new Set<number>();
  for (const batch of chunk(questions, EXISTS_CHUNK)) {
    const results = await Promise.all(
      batch.map(q => getDoc(doc(db, COLLECTION, `seed_${q.id}`)))
    );
    results.forEach((snap, i) => {
      if (snap.exists()) present.add(batch[i].id);
    });
  }

  const missing = questions.filter(q => !present.has(q.id));
  console.log(`Already present: ${present.size}`);
  console.log(`To write: ${missing.length}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    process.exit(0);
  }

  if (missing.length === 0) {
    console.log('\nNothing to do. All seed questions already exist.');
    process.exit(0);
  }

  const createdAt = new Date().toISOString();
  let written = 0;
  let failed = 0;

  for (const group of chunk(missing, WRITE_CHUNK)) {
    const batch = writeBatch(db);
    for (const q of group) {
      batch.set(doc(db, COLLECTION, `seed_${q.id}`), {
        text: q.question,
        options: [q.option_a, q.option_b],
        category: q.category,
        authorUid: SYSTEM_UID,
        isPublic: true,
        groupId: null,
        createdAt,
        status: 'live',
        flags: 0,
        // The feed sorts on these (App.tsx). Omitting `random` makes every
        // seeded question sort identically and defeats the shuffle.
        random: Math.random(),
        boostCount: 0,
      });
    }
    try {
      await batch.commit();
      written += group.length;
      console.log(`Committed ${group.length} (${written}/${missing.length})`);
    } catch (error) {
      failed += group.length;
      console.error(`Batch of ${group.length} failed:`, error instanceof Error ? error.message : error);
    }
  }

  console.log('\n=== Result ===');
  console.log(`Collection:      ${COLLECTION}`);
  console.log(`Documents written: ${written}`);
  console.log(`Skipped (already present): ${present.size}`);
  console.log(`Failed:          ${failed}`);
  console.log(`No other collection was touched.`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Seeding failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

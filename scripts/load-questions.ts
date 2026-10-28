/**
 * Loads question content with the Admin SDK (service key, see scripts/lib/adminDb.ts).
 *  - Adds Arabic text to the 210 Pulse Originals (seed_<id>), leaving votes and status alone.
 *  - Creates the v2 Pulse Originals (pulse2_<n>) as live, from src/pulse_questions_v2.json.
 * Idempotent. Usage: npx tsx scripts/load-questions.ts [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { adminDb, doc, getDoc, setDoc, updateDoc } from './lib/adminDb';

const DRY = process.argv.includes('--dry-run');
const db = adminDb();
const seed = JSON.parse(readFileSync('src/pulse_seed_questions.json', 'utf8')).questions;
const v2 = JSON.parse(readFileSync('src/pulse_questions_v2.json', 'utf8')).questions;

let arAdded = 0, arMissingDoc = 0, created = 0, existing = 0;
for (const q of seed) {
  if (!q.question_ar) continue;
  const ref = doc(db, 'questions', `seed_${q.id}`);
  if (!(await getDoc(ref)).exists()) { arMissingDoc++; continue; }
  if (!DRY) await updateDoc(ref, { text_ar: q.question_ar, options_ar: [q.option_a_ar, q.option_b_ar] });
  arAdded++;
}
for (const q of v2) {
  const id = 'pulse2_' + createHash('sha1').update(q.question).digest('hex').slice(0, 12);
  const ref = doc(db, 'questions', id);
  if ((await getDoc(ref)).exists()) { existing++; continue; }
  if (!DRY) await setDoc(ref, {
    text: q.question, options: [q.option_a, q.option_b],
    text_ar: q.question_ar, options_ar: [q.option_a_ar, q.option_b_ar],
    category: q.category, authorUid: 'pulse_originals_system', isPublic: true, groupId: null,
    createdAt: new Date().toISOString(), status: 'live', flags: 0, random: Math.random(), boostCount: 0,
  });
  created++;
}
console.log(`${DRY ? 'DRY RUN: would add' : 'Added'} Arabic to ${arAdded} originals (${arMissingDoc} not found in the database)`);
console.log(`${DRY ? 'DRY RUN: would create' : 'Created'} ${created} new questions (${existing} already present)`);
process.exit(0);

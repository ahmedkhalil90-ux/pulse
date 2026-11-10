import { doc, increment, setDoc, updateDoc } from 'firebase/firestore';
import type { Case } from '../helpers/env';
import { AUTHOR, FLAGGER, NEW_UID, OLD_UID, seedQuestion, seedUser } from '../helpers/fixtures';

const QN = 'qn1';
const qRef = (db: any) => doc(db, 'questions', QN);

export const questionsCases: Case[] = [
  {
    name: 'a non-author can flag a question as already asked',
    expect: 'allow', as: FLAGGER, seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { flags_duplicate: increment(1) }),
  },
  {
    name: 'an already-asked flag adds exactly one',
    expect: 'deny', killedBy: 'M123', as: FLAGGER, seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { flags_duplicate: increment(5) }),
  },
  {
    name: 'an already-asked flag cannot hide the question',
    expect: 'deny', killedBy: 'M124', as: FLAGGER, seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { flags_duplicate: increment(1), status: 'flagged' }),
  },
  {
    name: 'the author cannot flag their own question as already asked',
    expect: 'deny', killedBy: 'M125', as: AUTHOR, seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { flags_duplicate: increment(1) }),
  },
  {
    name: 'flag by a non-author, +1 with one reason counter, is allowed',
    expect: 'allow',
    as: FLAGGER,
    seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { flags: increment(1), flags_unclear: increment(1) }),
  },
  {
    name: 'flag by the author is rejected',
    expect: 'deny',
    killedBy: 'M6',
    as: AUTHOR,
    seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { flags: increment(1), flags_unclear: increment(1) }),
  },
  {
    name: 'setting flags to 0 is rejected',
    expect: 'deny',
    killedBy: 'M7',
    // The reason counter is bumped legitimately so the only clause this write
    // violates is the flags == old + 1 equality -- otherwise the reason-sum
    // clause would reject it too and the mutation would prove nothing.
    as: FLAGGER,
    seed: (ctx) => seedQuestion(ctx, QN, { flags: 3, flags_unclear: 3 }),
    run: (db) => updateDoc(qRef(db), { flags: 0, flags_unclear: increment(1) }),
  },
  {
    name: "setting status to 'live' by a non-admin is rejected",
    expect: 'deny',
    killedBy: 'M8',
    as: FLAGGER,
    seed: (ctx) => seedQuestion(ctx, QN, { status: 'pending' }),
    run: (db) =>
      updateDoc(qRef(db), {
        flags: increment(1),
        flags_unclear: increment(1),
        status: 'live',
      }),
  },
  {
    name: "setting status to 'live' alone by a non-admin is rejected",
    expect: 'deny',
    note:
      'Rejected by the flag-count arithmetic rather than the status guard, ' +
      'since a bare status write is not a flag write at all.',
    as: FLAGGER,
    seed: (ctx) => seedQuestion(ctx, QN, { status: 'pending' }),
    run: (db) => updateDoc(qRef(db), { status: 'live' }),
  },
  {
    name: "setting status to 'flagged' below the auto-hide threshold is rejected",
    expect: 'deny',
    killedBy: 'M8',
    as: FLAGGER,
    seed: (ctx) => seedQuestion(ctx, QN, { flags: 1, flags_unclear: 1 }),
    run: (db) =>
      updateDoc(qRef(db), {
        flags: increment(1),
        flags_unclear: increment(1),
        status: 'flagged',
      }),
  },
  {
    name: 'boost by the author, exactly +100, is allowed',
    expect: 'allow',
    as: AUTHOR,
    seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { boostCount: increment(100) }),
  },
  {
    name: 'boost by a non-author is rejected',
    expect: 'deny',
    killedBy: 'M9',
    as: FLAGGER,
    seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { boostCount: increment(100) }),
  },
  {
    name: 'boost by an amount other than +100 is rejected',
    expect: 'deny',
    killedBy: 'M10',
    as: AUTHOR,
    seed: (ctx) => seedQuestion(ctx, QN),
    run: (db) => updateDoc(qRef(db), { boostCount: increment(1000) }),
  },
  {
    name: 'migration write that also changes text is rejected',
    expect: 'deny',
    killedBy: 'M11',
    as: NEW_UID,
    seed: async (ctx) => {
      // Orphaned profile under the old UID, username 'victim'. The caller's
      // token is victim@pulse.app, so the migration itself is legitimate --
      // only the extra text edit must be refused.
      await seedUser(ctx, OLD_UID, { username: 'victim' });
      await seedQuestion(ctx, QN, { authorUid: OLD_UID, text: 'original text' });
    },
    run: (db) => updateDoc(qRef(db), { authorUid: NEW_UID.uid, text: 'hijacked text' }),
  },
  // --- create: moderation cannot be skipped (found by the attacker bots) ---
  {
    name: 'a user may submit a public question as pending',
    expect: 'allow',
    as: AUTHOR,
    seed: (ctx) => seedUser(ctx, AUTHOR.uid),
    run: (db) => setDoc(doc(db, 'questions', 'new_pending'), {
        text: 'Karak or flat white?', options: ['Karak', 'Flat white'], category: 'Food',
        authorUid: AUTHOR.uid, isPublic: true, groupId: null, createdAt: '2026-10-27T00:00:00.000Z',
        status: 'pending', flags: 0, random: 0.5, boostCount: 0,
      }),
  },
  {
    name: 'a user may not publish a public question straight to live',
    expect: 'deny',
    killedBy: 'M79',
    as: AUTHOR,
    seed: (ctx) => seedUser(ctx, AUTHOR.uid),
    run: (db) => setDoc(doc(db, 'questions', 'new_live'), {
        text: 'Karak or flat white?', options: ['Karak', 'Flat white'], category: 'Food',
        authorUid: AUTHOR.uid, isPublic: true, groupId: null, createdAt: '2026-10-27T00:00:00.000Z',
        status: 'live', flags: 0, random: 0.5, boostCount: 0,
      }),
  },
  {
    name: 'a user may not post as the official Pulse Originals account',
    expect: 'deny',
    killedBy: 'M80',
    as: AUTHOR,
    seed: (ctx) => seedUser(ctx, AUTHOR.uid),
    run: (db) => setDoc(doc(db, 'questions', 'fake_official'), {
        text: 'Karak or flat white?', options: ['Karak', 'Flat white'], category: 'Food',
        authorUid: 'pulse_originals_system', isPublic: true, groupId: null, createdAt: '2026-10-27T00:00:00.000Z',
        status: 'live', flags: 0, random: 0.5, boostCount: 0,
      }),
  },
];

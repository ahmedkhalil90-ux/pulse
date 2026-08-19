import { doc, updateDoc } from 'firebase/firestore';
import type { Case } from '../helpers/env';
import { ATTACKER, OWNER, QID, seedAnswer, seedUser } from '../helpers/fixtures';

const answerRef = (db: any) => doc(db, 'user_answers', `${OWNER.uid}_${QID}`);

export const userAnswersCases: Case[] = [
  {
    name: 'owner updating their own answer (revisit) is allowed',
    expect: 'allow',
    as: OWNER,
    seed: (ctx) => seedAnswer(ctx, OWNER.uid, QID, 0),
    run: (db) => updateDoc(answerRef(db), { answerIndex: 1, isRevisit: true }),
  },
  {
    name: "updating a record belonging to another user is rejected",
    expect: 'deny',
    killedBy: 'M13',
    as: ATTACKER,
    seed: async (ctx) => {
      await seedUser(ctx, ATTACKER.uid);
      await seedAnswer(ctx, OWNER.uid, QID, 0);
    },
    run: (db) => updateDoc(answerRef(db), { answerIndex: 1 }),
  },
  {
    name: 'changing questionId on an existing record is rejected',
    expect: 'deny',
    killedBy: 'M14',
    as: OWNER,
    seed: (ctx) => seedAnswer(ctx, OWNER.uid, QID, 0),
    run: (db) => updateDoc(answerRef(db), { questionId: 'q2' }),
  },
];

import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RulesTestContext } from '@firebase/rules-unit-testing';
import type { Case } from '../helpers/env';

/**
 * Game question authorship.
 *
 * game_questions used to carry authorUid and authorUsername, readable by every
 * player from the moment of submission. CLAUDE.md: "Question author revealed
 * only on the final results screen." Attribution now lives in
 * game_question_authors, readable only once the game is finished.
 */
const AUTHOR = { uid: 'ga-author', email: 'gaauthor@pulse.app' };
const OTHER = { uid: 'ga-other', email: 'gaother@pulse.app' };
const OUTSIDER = { uid: 'ga-outsider', email: 'gaoutsider@pulse.app' };
const GID = 'ga-game';
const QID = 'ga-question';

const seedGame = (status: string) => async (ctx: RulesTestContext) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'games', GID), {
    type: 'live',
    status,
    hostUid: AUTHOR.uid,
    players: [AUTHOR.uid, OTHER.uid],
    questions: [QID],
    currentQuestionIndex: 0,
    inviteCode: 'GA0001',
    questionsPerPlayer: 1,
    createdAt: '2026-08-19T00:00:00.000Z',
    scores: {},
    answers: {},
    predictions: {},
  });
  await setDoc(doc(db, 'game_questions', QID), {
    gameId: GID,
    text: 'Coffee or tea?',
    options: ['Coffee', 'Tea'],
    createdAt: '2026-08-19T00:00:00.000Z',
  });
  await setDoc(doc(db, 'game_question_authors', QID), {
    gameId: GID,
    authorUid: AUTHOR.uid,
    authorUsername: 'gaauthor',
  });
};

const readAuthor = (db: any) => getDoc(doc(db, 'game_question_authors', QID));

export const gameAuthorCases: Case[] = [
  // --- the question itself --------------------------------------------------
  {
    name: 'a player can read a game question while the game is active',
    expect: 'allow',
    as: OTHER,
    seed: seedGame('active'),
    run: (db) => getDoc(doc(db, 'game_questions', QID)),
  },
  {
    name: 'a game question cannot be created carrying an author',
    expect: 'deny',
    killedBy: 'M48',
    // Belt and braces: authorship must not creep back onto the question.
    as: AUTHOR,
    seed: seedGame('active'),
    run: (db) =>
      setDoc(doc(db, 'game_questions', 'another-q'), {
        gameId: GID,
        text: 'Cats or dogs?',
        options: ['Cats', 'Dogs'],
        createdAt: '2026-08-20T00:00:00.000Z',
        authorUsername: 'gaauthor',
      }),
  },

  // --- attribution is gated on the game being finished ----------------------
  {
    name: 'a player cannot read authorship while the game is active',
    expect: 'deny',
    killedBy: 'M49',
    as: OTHER,
    seed: seedGame('active'),
    run: readAuthor,
  },
  {
    name: 'a player cannot read authorship while the game is in the lobby',
    expect: 'deny',
    killedBy: 'M49',
    as: OTHER,
    seed: seedGame('lobby'),
    run: readAuthor,
  },
  {
    name: 'a player can read authorship once the game is finished',
    expect: 'allow',
    // This is the final results screen, which is where CLAUDE.md permits it.
    as: OTHER,
    seed: seedGame('finished'),
    run: readAuthor,
  },
  {
    name: 'the author cannot read their own attribution early either',
    expect: 'deny',
    killedBy: 'M49',
    // No exception for the author: a uniform rule is one fewer way to leak.
    as: AUTHOR,
    seed: seedGame('active'),
    run: readAuthor,
  },
  {
    name: 'a non-player cannot read authorship even once finished',
    expect: 'deny',
    killedBy: 'M50a',
    as: OUTSIDER,
    seed: seedGame('finished'),
    run: readAuthor,
  },

  // --- writing attribution --------------------------------------------------
  {
    name: 'a player may attribute their own submission',
    expect: 'allow',
    as: OTHER,
    seed: seedGame('active'),
    run: (db) =>
      setDoc(doc(db, 'game_question_authors', 'other-q'), {
        gameId: GID,
        authorUid: OTHER.uid,
        authorUsername: 'gaother',
      }),
  },
  {
    name: 'a player cannot attribute a submission to someone else',
    expect: 'deny',
    killedBy: 'M51a',
    as: OTHER,
    seed: seedGame('active'),
    run: (db) =>
      setDoc(doc(db, 'game_question_authors', 'other-q'), {
        gameId: GID,
        authorUid: AUTHOR.uid,
        authorUsername: 'gaauthor',
      }),
  },
  {
    name: 'attribution cannot be rewritten once set',
    expect: 'deny',
    killedBy: 'M52a',
    // Otherwise the author could swap the name in before the reveal.
    as: AUTHOR,
    seed: seedGame('finished'),
    run: (db) =>
      setDoc(doc(db, 'game_question_authors', QID), {
        gameId: GID,
        authorUid: AUTHOR.uid,
        authorUsername: 'someone-else',
      }),
  },
];

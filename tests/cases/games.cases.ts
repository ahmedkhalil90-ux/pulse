import { arrayUnion, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { Case } from '../helpers/env';
import type { RulesTestContext } from '@firebase/rules-unit-testing';

/**
 * games/{gameId} read access.
 *
 * Game documents carry `answers` and `predictions` maps keyed by player UID.
 * CLAUDE.md: no player may ever see another player's specific answer, and
 * predictions are stored privately and never exposed. So non-players must not
 * be able to read a game that is under way.
 *
 * Joining by code (GameHome.tsx:156-165) queries games by inviteCode BEFORE
 * the caller is a player, so that path has to keep working. Rules cannot see a
 * query's where-clauses, so "knows the code" is not checkable; what is
 * checkable is that the game has not started -- a lobby game holds no answers
 * or predictions yet.
 */
const PLAYER = { uid: 'gplayer1', email: 'gplayer1@pulse.app' };
const OUTSIDER = { uid: 'goutsider1', email: 'goutsider1@pulse.app' };
/** A second, non-host player. */
const SECOND = { uid: 'gplayer2', email: 'gplayer2@pulse.app' };
const GID = 'gsec1';

const BASE = {
  type: 'live',
  hostUid: PLAYER.uid,
  players: [PLAYER.uid],
  questions: ['gq1'],
  currentQuestionIndex: 0,
  inviteCode: 'JOIN01',
  questionsPerPlayer: 1,
  createdAt: '2026-08-19T00:00:00.000Z',
  scores: {},
  // The payload that must never reach a non-player.
  answers: { [PLAYER.uid]: { gq1: 1 } },
  predictions: { [PLAYER.uid]: { gq1: 0 } },
};

const seedGame = (status: string, extra: Record<string, unknown> = {}) => (ctx: RulesTestContext) =>
  setDoc(doc(ctx.firestore(), 'games', GID), { ...BASE, status, ...extra });

const readGame = (db: any) => getDoc(doc(db, 'games', GID));

export const gamesCases: Case[] = [
  {
    name: 'a player can read their own active game',
    expect: 'allow',
    as: PLAYER,
    seed: seedGame('active'),
    run: readGame,
  },
  {
    name: 'a non-player cannot read an active game',
    expect: 'deny',
    killedBy: 'M15',
    as: OUTSIDER,
    seed: seedGame('active'),
    run: readGame,
  },
  {
    name: 'a non-player cannot read a finished game',
    expect: 'deny',
    killedBy: 'M15',
    as: OUTSIDER,
    seed: seedGame('finished'),
    run: readGame,
  },
  {
    name: 'a non-player can read a lobby game, so joining by code still works',
    expect: 'allow',
    as: OUTSIDER,
    // A lobby game has no answers or predictions yet.
    seed: seedGame('lobby', { answers: {}, predictions: {} }),
    run: readGame,
  },
  {
    name: 'an unauthenticated caller cannot read a lobby game',
    expect: 'deny',
    killedBy: 'M16',
    as: 'unauthenticated',
    seed: seedGame('lobby', { answers: {}, predictions: {} }),
    run: readGame,
  },
  {
    name: 'a player can still read their game once it has finished',
    expect: 'allow',
    as: PLAYER,
    seed: seedGame('finished'),
    run: readGame,
  },

  // --- joining --------------------------------------------------------------
  {
    name: 'a non-player may join a lobby game, adding themselves and a score',
    expect: 'allow',
    as: OUTSIDER,
    seed: seedGame('lobby', { answers: {}, predictions: {} }),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), {
        players: arrayUnion(OUTSIDER.uid),
        [`scores.${OUTSIDER.uid}`]: 0,
      }),
  },
  {
    name: 'a non-player cannot join a game that has already started',
    expect: 'deny',
    killedBy: 'M26',
    as: OUTSIDER,
    seed: seedGame('active'),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), { players: arrayUnion(OUTSIDER.uid) }),
  },
  {
    name: 'a non-player cannot join a finished game',
    expect: 'deny',
    killedBy: 'M26',
    as: OUTSIDER,
    seed: seedGame('finished'),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), { players: arrayUnion(OUTSIDER.uid) }),
  },
  {
    name: 'a player cannot drag another user into a lobby game',
    expect: 'deny',
    killedBy: 'M27',
    as: PLAYER,
    seed: seedGame('lobby', { answers: {}, predictions: {} }),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), { players: arrayUnion('dragged-in-uid') }),
  },
  {
    name: 'joining cannot smuggle another field alongside players',
    expect: 'deny',
    killedBy: 'M28',
    as: OUTSIDER,
    seed: seedGame('lobby', { answers: {}, predictions: {} }),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), {
        players: arrayUnion(OUTSIDER.uid),
        status: 'finished',
      }),
  },

  // --- leaving --------------------------------------------------------------
  {
    name: 'a player may remove themselves from a game',
    expect: 'allow',
    as: SECOND,
    seed: seedGame('lobby', { players: [PLAYER.uid, SECOND.uid], answers: {}, predictions: {} }),
    run: (db) => updateDoc(doc(db, 'games', GID), { players: [PLAYER.uid] }),
  },
  {
    name: 'a player cannot remove another player',
    expect: 'deny',
    killedBy: 'M29',
    as: SECOND,
    seed: seedGame('lobby', { players: [PLAYER.uid, SECOND.uid], answers: {}, predictions: {} }),
    run: (db) => updateDoc(doc(db, 'games', GID), { players: [SECOND.uid] }),
  },

  // --- host progression -----------------------------------------------------
  {
    name: 'the host may advance the game',
    expect: 'allow',
    as: PLAYER, // PLAYER is hostUid in the fixture
    seed: seedGame('active'),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), {
        status: 'finished',
        currentQuestionIndex: 0,
        scores: { [PLAYER.uid]: 1 },
        scoredQuestions: ['gq1'],
        lastUpdated: '2026-08-20T00:00:00.000Z',
      }),
  },
  {
    name: 'the host cannot add a player while advancing',
    expect: 'deny',
    killedBy: 'M30',
    as: PLAYER,
    seed: seedGame('active'),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), {
        status: 'finished',
        players: arrayUnion('smuggled-uid'),
      }),
  },
  {
    name: 'a non-host player cannot change the game status',
    expect: 'deny',
    killedBy: 'M31',
    as: SECOND,
    seed: seedGame('active', { players: [PLAYER.uid, SECOND.uid] }),
    run: (db) => updateDoc(doc(db, 'games', GID), { status: 'finished' }),
  },

  // --- player writes --------------------------------------------------------
  {
    name: 'a player may record their own answer and prediction',
    expect: 'allow',
    as: SECOND,
    seed: seedGame('active', { players: [PLAYER.uid, SECOND.uid] }),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), {
        [`answers.${SECOND.uid}.gq1`]: 1,
        [`predictions.${SECOND.uid}.gq1`]: 0,
        lastUpdated: '2026-08-20T00:00:00.000Z',
      }),
  },
  {
    name: 'a player may submit their own questions',
    expect: 'allow',
    as: SECOND,
    seed: seedGame('active', { players: [PLAYER.uid, SECOND.uid] }),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), {
        questions: arrayUnion('gq2'),
        [`playerQuestions.${SECOND.uid}`]: ['gq2'],
        lastUpdated: '2026-08-20T00:00:00.000Z',
      }),
  },
  {
    name: "a player cannot write another player's answer",
    expect: 'deny',
    killedBy: 'M32',
    as: SECOND,
    seed: seedGame('active', { players: [PLAYER.uid, SECOND.uid] }),
    run: (db) => updateDoc(doc(db, 'games', GID), { [`answers.${PLAYER.uid}.gq1`]: 0 }),
  },
  {
    name: "a player cannot write another player's prediction",
    expect: 'deny',
    killedBy: 'M32',
    as: SECOND,
    seed: seedGame('active', { players: [PLAYER.uid, SECOND.uid] }),
    run: (db) => updateDoc(doc(db, 'games', GID), { [`predictions.${PLAYER.uid}.gq1`]: 1 }),
  },
  {
    name: "a player cannot rewrite another player's question submission",
    expect: 'deny',
    killedBy: 'M32',
    as: SECOND,
    seed: seedGame('active', { players: [PLAYER.uid, SECOND.uid] }),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), { [`playerQuestions.${PLAYER.uid}`]: ['hijack'] }),
  },
  {
    name: 'a player cannot delete existing questions while submitting',
    expect: 'deny',
    killedBy: 'M33',
    as: SECOND,
    seed: seedGame('active', { players: [PLAYER.uid, SECOND.uid] }),
    run: (db) =>
      updateDoc(doc(db, 'games', GID), {
        questions: ['gq-replaced'],
        [`playerQuestions.${SECOND.uid}`]: ['gq-replaced'],
      }),
  },
  {
    name: 'a player cannot rewrite the scores map',
    expect: 'deny',
    killedBy: 'M31',
    as: SECOND,
    seed: seedGame('active', { players: [PLAYER.uid, SECOND.uid] }),
    run: (db) => updateDoc(doc(db, 'games', GID), { scores: { [SECOND.uid]: 999 } }),
  },
];

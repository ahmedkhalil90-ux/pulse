import { collectionGroup, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import type { Case } from '../helpers/env';
import { INVITE, seedInvite } from '../helpers/fixtures';

/** Consent at sign-up, account deletion requests, the contact form. */
const M = { uid: 'pv-member', email: 'pv@example.com' };
const OTHER = { uid: 'pv-other', email: 'pv2@example.com' };
const profile = (extra: Record<string, unknown> = {}) => ({ credits: 13, isVerified: false, invitedWith: INVITE, consentVersion: '2026-11-17', ...extra });

const seedMembers = async (c: any) => {
  const db = c.firestore();
  await setDoc(doc(db, 'groups', 'g1'), { name: 'G', memberCount: 2, adminUid: OTHER.uid });
  await setDoc(doc(db, 'groups', 'g1', 'members', M.uid), { uid: M.uid, joinedAt: 'x' });
  await setDoc(doc(db, 'groups', 'g1', 'members', OTHER.uid), { uid: OTHER.uid, joinedAt: 'x' });
};

export const privacyCases: Case[] = [
  {
    name: 'a member can list their own group memberships across all groups', expect: 'allow', as: M, seed: seedMembers,
    run: (db) => getDocs(query(collectionGroup(db, 'members'), where('uid', '==', M.uid))),
  },
  {
    name: "a member cannot list other people's group memberships", expect: 'deny', killedBy: 'M143', as: M, seed: seedMembers,
    run: (db) => getDocs(query(collectionGroup(db, 'members'))),
  },
  {
    name: 'sign-up records the accepted privacy policy version', expect: 'allow', as: M, seed: (c) => seedInvite(c),
    run: (db) => setDoc(doc(db, 'users', M.uid), profile()),
  },
  {
    name: 'sign-up without accepting the privacy policy is refused', expect: 'deny', killedBy: 'M138', as: M, seed: (c) => seedInvite(c),
    run: (db) => setDoc(doc(db, 'users', M.uid), (({ consentVersion, ...rest }) => rest)(profile())),
  },
  {
    name: 'a member can ask to delete their account', expect: 'allow', as: M,
    run: (db) => setDoc(doc(db, 'deletionRequests', M.uid), { requestedAt: serverTimestamp() }),
  },
  {
    name: "a member cannot ask to delete someone else's account", expect: 'deny', killedBy: 'M139', as: OTHER,
    run: (db) => setDoc(doc(db, 'deletionRequests', M.uid), { requestedAt: serverTimestamp() }),
  },
  {
    name: 'a deletion request holds only its time', expect: 'deny', killedBy: 'M140', as: M,
    run: (db) => setDoc(doc(db, 'deletionRequests', M.uid), { requestedAt: serverTimestamp(), note: 'x' }),
  },
  {
    name: 'a deletion request cannot be withdrawn by the member', expect: 'deny', note: 'update and delete are admin-only; no single guard to loosen.', as: M,
    seed: async (c) => { await setDoc(doc(c.firestore(), 'deletionRequests', M.uid), { requestedAt: new Date() }); },
    run: (db) => setDoc(doc(db, 'deletionRequests', M.uid), { requestedAt: serverTimestamp() }),
  },
  {
    name: 'a member can send feedback', expect: 'allow', as: M,
    run: (db) => setDoc(doc(db, 'feedback', 'f1'), { uid: M.uid, text: 'Love the Knockouts', kind: 'idea', createdAt: serverTimestamp() }),
  },
  {
    name: "feedback cannot be sent in another member's name", expect: 'deny', killedBy: 'M141', as: OTHER,
    run: (db) => setDoc(doc(db, 'feedback', 'f1'), { uid: M.uid, text: 'x', kind: 'idea', createdAt: serverTimestamp() }),
  },
  {
    name: 'feedback has a length limit', expect: 'deny', killedBy: 'M142', as: M,
    run: (db) => setDoc(doc(db, 'feedback', 'f1'), { uid: M.uid, text: 'x'.repeat(5000), kind: 'other', createdAt: serverTimestamp() }),
  },
  {
    name: 'members cannot read feedback', expect: 'deny', note: 'read is admin-only; no single guard to loosen.', as: OTHER,
    seed: async (c) => { await setDoc(doc(c.firestore(), 'feedback', 'f1'), { uid: M.uid, text: 'x', kind: 'idea' }); },
    run: (db) => getDoc(doc(db, 'feedback', 'f1')),
  },
];

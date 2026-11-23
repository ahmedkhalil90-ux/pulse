import { addDoc, collection, doc, getDoc, getDocs, increment, query, setDoc, updateDoc, where, type Firestore } from 'firebase/firestore';
import type { Group } from '../types';

export const generateInviteCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
};

/**
 * Create a group with the caller as its first member. The membership document
 * matters: "My groups" and posting rights both come from groups/{id}/members,
 * and a creator without one lost their own group after a reload.
 */
export async function createGroup(db: Firestore, uid: string, name: string, description = ''): Promise<Group> {
  const data = {
    name: name.trim(), description: description.trim(), inviteCode: generateInviteCode(),
    adminUid: uid, memberCount: 1, createdAt: new Date().toISOString(),
  };
  const ref = await addDoc(collection(db, 'groups'), data);
  await setDoc(doc(db, 'groups', ref.id, 'members', uid), { uid, joinedAt: new Date().toISOString() });
  return { id: ref.id, ...data } as Group;
}

export class GroupJoinError extends Error {
  constructor(public readonly reason: 'invalid-code' | 'already-member', public readonly group?: Group) { super(reason); }
}

/** Join by invite code: proof of the code, then membership, then the count. */
export async function joinGroupByCode(db: Firestore, uid: string, rawCode: string): Promise<Group> {
  const code = rawCode.toUpperCase();
  const snapshot = await getDocs(query(collection(db, 'groups'), where('inviteCode', '==', code)));
  if (snapshot.empty) throw new GroupJoinError('invalid-code');
  const groupDoc = snapshot.docs[0];
  const group = { id: groupDoc.id, ...groupDoc.data() } as Group;
  if ((await getDoc(doc(db, 'groups', groupDoc.id, 'members', uid))).exists()) throw new GroupJoinError('already-member', group);
  // The rules compare this proof with the group's code server-side; the
  // membership write below is refused unless it landed first.
  await setDoc(doc(db, 'groups', groupDoc.id, 'joinRequests', uid), { code });
  await setDoc(doc(db, 'groups', groupDoc.id, 'members', uid), { uid, joinedAt: new Date().toISOString() });
  await updateDoc(groupDoc.ref, { memberCount: increment(1) });
  return { ...group, memberCount: (group.memberCount ?? 0) + 1 };
}

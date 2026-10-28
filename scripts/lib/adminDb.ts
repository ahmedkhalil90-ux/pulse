/**
 * Admin-SDK Firestore with the same small API the migration scripts already
 * use (collection, doc, getDocs, getDoc, setDoc, updateDoc), so they run with
 * a service-account key instead of an app username and password.
 *
 * The key is a credential: keep it at .secrets/service-account.json (git-
 * ignored) or point PULSE_SA_KEY at it. The Admin SDK bypasses security
 * rules, so these scripts no longer depend on which rules are deployed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore, type DocumentReference, type CollectionReference } from 'firebase-admin/firestore';

export function adminDb(): Firestore {
  const keyPath = process.env.PULSE_SA_KEY ?? path.resolve('.secrets/service-account.json');
  let key: Record<string, string>;
  try {
    key = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch {
    console.error(`No service-account key at ${keyPath}. See scripts/deploy-beta.ps1 step 3.`);
    process.exit(1);
  }
  console.log(`Using service account ${key.client_email} on project ${key.project_id}.`);
  return getFirestore(initializeApp({ credential: cert(key as never) }));
}

export const collection = (db: Firestore, ...segs: string[]) => db.collection(segs.join('/'));
export const doc = (db: Firestore, ...segs: string[]) => db.doc(segs.join('/'));
export const getDocs = (ref: CollectionReference) => ref.get();
export async function getDoc(ref: DocumentReference) {
  const s = await ref.get();
  return { id: s.id, exists: () => s.exists, data: () => s.data() as Record<string, any> };
}
export const setDoc = (ref: DocumentReference, data: Record<string, unknown>) => ref.set(data);
export const updateDoc = (ref: DocumentReference, data: Record<string, unknown>) => ref.update(data);

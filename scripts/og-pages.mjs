#!/usr/bin/env node
/**
 * After `vite build`: writes dist/q/<id>.html for every live public question,
 * so a shared question link shows the question itself in WhatsApp and other
 * chat apps. Run before the hosting deploy.
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=<key.json> node scripts/og-pages.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { questionPage } from './lib/og.mjs';

const key = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
const origin = `https://${key.project_id}.web.app`;
const db = getFirestore(initializeApp({ credential: cert(key) }));
const index = readFileSync('dist/index.html', 'utf8');
const snap = await db.collection('questions').where('status', '==', 'live').where('isPublic', '==', true).select('text', 'options').get();
mkdirSync('dist/q', { recursive: true });
let n = 0;
for (const d of snap.docs) {
  const q = { id: d.id, ...d.data() };
  if (!q.text || q.options?.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(q.id)) continue;
  writeFileSync(`dist/q/${q.id}.html`, questionPage(index, q, origin));
  n++;
}
console.log(`share previews: ${n} question pages`);
process.exit(0);

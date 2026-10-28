// Deploy rules, indexes and hosting through the Firebase REST APIs with a
// service-account key (Admin SDK auth). Used where the firebase CLI cannot
// authenticate. Usage: node scripts/deploy-api.mjs rules|indexes|hosting
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

const key = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
const PROJECT = key.project_id;
const app = initializeApp({ credential: cert(key) });
const token = async () => (await app.options.credential.getAccessToken()).access_token;

async function api(method, url, body, headers = {}) {
  const r = await fetch(url, {
    method, body: body && !(body instanceof Buffer) ? JSON.stringify(body) : body,
    headers: { authorization: `Bearer ${await token()}`, ...(body && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...headers },
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 400)}`), { status: r.status });
  return text ? JSON.parse(text) : {};
}

async function rules() {
  const rs = await getSecurityRules(app).releaseFirestoreRulesetFromSource(readFileSync('firestore.rules', 'utf8'));
  console.log('rules released:', rs.name);
}

async function indexes() {
  const cfg = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups`;
  for (const ix of cfg.indexes ?? []) {
    try {
      await api('POST', `${base}/${ix.collectionGroup}/indexes`, { queryScope: ix.queryScope, fields: ix.fields });
      console.log('index created:', ix.collectionGroup, ix.fields.map(f => f.fieldPath).join(','));
    } catch (e) {
      if (e.status === 409) console.log('index exists:', ix.collectionGroup, ix.fields.map(f => f.fieldPath).join(','));
      else throw e;
    }
  }
  for (const fo of cfg.fieldOverrides ?? []) {
    const indexes = fo.indexes.map(i => ({ queryScope: i.queryScope, fields: [{ fieldPath: fo.fieldPath, ...(i.order ? { order: i.order } : { arrayConfig: i.arrayConfig }) }] }));
    await api('PATCH', `${base}/${fo.collectionGroup}/fields/${fo.fieldPath}?updateMask=indexConfig`, { indexConfig: { indexes } });
    console.log('field override set:', fo.collectionGroup, fo.fieldPath);
  }
}

async function hosting() {
  const site = PROJECT;
  const hcfg = JSON.parse(readFileSync('firebase.json', 'utf8')).hosting;
  const H = 'https://firebasehosting.googleapis.com/v1beta1';
  const v = await api('POST', `${H}/sites/${site}/versions`, { config: {
    rewrites: hcfg.rewrites.map(r => ({ glob: r.source, path: r.destination })),
    headers: (hcfg.headers ?? []).map(h => ({ glob: h.source, headers: Object.fromEntries(h.headers.map(x => [x.key, x.value])) })),
  } });
  const files = {}; const blobs = {};
  const walk = d => readdirSync(d).forEach(f => { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : (() => {
    const gz = zlib.gzipSync(readFileSync(p), { level: 9 }); const h = crypto.createHash('sha256').update(gz).digest('hex');
    files['/' + path.relative(hcfg.public, p).split(path.sep).join('/')] = h; blobs[h] = gz; })(); });
  walk(hcfg.public);
  const pop = await api('POST', `${H}/${v.name}:populateFiles`, { files });
  for (const h of pop.uploadRequiredHashes ?? []) await api('POST', `${pop.uploadUrl}/${h}`, blobs[h], { 'content-type': 'application/octet-stream' });
  await api('PATCH', `${H}/${v.name}?update_mask=status`, { status: 'FINALIZED' });
  await api('POST', `${H}/sites/${site}/releases?versionName=${v.name}`, {});
  console.log(`hosting released: ${Object.keys(files).length} files -> https://${site}.web.app`);
}

const step = process.argv[2];
await ({ rules, indexes, hosting })[step]();
process.exit(0);

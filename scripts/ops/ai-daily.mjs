#!/usr/bin/env node
/**
 * Daily AI bot: spends the free Gemini and Groq quotas on Pulse's question bank.
 * Runs in GitHub Actions (.github/workflows/daily-ops.yml). Time-boxed; stops
 * early when every free model is out of quota.
 *
 *   1. moderate  user questions waiting at 'pending': both models must agree it
 *                is safe to publish; a clear violation is rejected; anything in
 *                between stays pending for the admin queue.
 *   2. trends    what people in the UAE and Egypt are talking about this week
 *                (Gemini + Google Search), turned into questions that expire in
 *                14 days.
 *   3. dialects  Gulf and Egyptian Arabic versions of existing questions.
 *   4. generate  new questions per category in the style of the current top
 *                performers; reviewed by a second model; kept in a pool that
 *                the ranking job feeds into the exploring slot.
 *   5. report    ops/daily in Firestore plus daily-report.md for the GitHub issue.
 *
 * Env: GEMINI_API_KEY, GROQ_API_KEY, PULSE_SA_KEY (path), MAX_MINUTES (default 14),
 *      TASKS (comma list, default all). Only system questions are written; no
 *      user data is ever sent to a model except the text of submitted questions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const key = JSON.parse(readFileSync(process.env.PULSE_SA_KEY, 'utf8'));
const db = getFirestore(initializeApp({ credential: cert(key) }));
const DEADLINE = Date.now() + Number(process.env.MAX_MINUTES ?? 14) * 60000;
const TASKS = (process.env.TASKS ?? 'moderate,trends,dialects,generate').split(',');
const timeLeft = () => DEADLINE - Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const report = { moderated: { approved: 0, rejected: 0, held: 0 }, trends: 0, dialects: 0, generated: 0, pooled: 0, calls: {}, exhausted: [], errors: [] };

const RED_LINES = 'religion or religious practice or places, politics, governments, rulers or royal families, sexuality, anything sexual, alcohol, drugs, gambling, crime, self-harm, ethnic or nationality stereotypes, immigration status, real private individuals, defamation of real people or brands';
const CATEGORIES = ['Money & Salary', 'Family & Marriage', 'Gulf Work Life', 'Expat Life', 'Food Wars', 'Football', 'Ramadan & Eid', 'Tech & AI', 'Dating & Friendship', 'City Rivalries', 'Guilty Confessions', 'Would You Rather'];

// ---------- models: rotate through every free model until its quota is gone ----------
const GEMINI = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
const GROQ = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
const dead = new Set();
const json = (t) => JSON.parse(t.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim().replace(/^[^[{]*/, ''));

async function gemini(prompt, { search = false } = {}) {
  for (const m of GEMINI) {
    if (dead.has(m)) continue;
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, ...(search ? {} : { responseMimeType: 'application/json' }) } };
    if (search) body.tools = [{ google_search: {} }];
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body),
      });
      report.calls[m] = (report.calls[m] ?? 0) + 1;
      if (r.status === 429) { dead.add(m); report.exhausted.push(m); continue; }
      if (!r.ok) { if (r.status === 404 || r.status === 400) dead.add(m); continue; }
      const d = await r.json();
      return json(d.candidates[0].content.parts.map((p) => p.text || '').join(''));
    } catch (e) { report.errors.push(`${m}: ${String(e.message).slice(0, 80)}`); }
  }
  return null;
}

async function groq(prompt) {
  for (const m of GROQ) {
    if (dead.has(m)) continue;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model: m, temperature: 0.2, response_format: { type: 'json_object' }, ...(m.startsWith('openai/') ? { reasoning_effort: 'low' } : {}), messages: [{ role: 'user', content: prompt + '\nReturn only json.' }] }),
      });
      report.calls[m] = (report.calls[m] ?? 0) + 1;
      if (r.status === 429) {
        const daily = /per day|TPD|RPD/i.test(await r.text());
        if (daily) { dead.add(m); report.exhausted.push(m); } else await sleep(20000);
        continue;
      }
      if (!r.ok) continue;
      return json((await r.json()).choices[0].message.content);
    } catch (e) { report.errors.push(`${m}: ${String(e.message).slice(0, 80)}`); }
  }
  return null;
}
const allDead = () => GEMINI.every((m) => dead.has(m)) && GROQ.every((m) => dead.has(m));

// ---------- shared ----------
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
const jac = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); };
let known = [];
const isDup = (text) => { const t = norm(text); return known.some((k) => jac(k, t) > 0.5); };
const qid = (text) => 'ai_' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 14);

const SAFETY = (items) => `You review two-option poll questions for Pulse, an anonymous polling app for young adults in the UAE and Egypt, before publication.
For each item: "safe": false if it touches ${RED_LINES}, could embarrass or endanger someone in the UAE or Egypt, or is hateful, sexual or harassing.
"quality" 1-5: is it clear, are both options plausible (a near 50/50 split is ideal), would people want to see the result.
Items: ${JSON.stringify(items)}
Return {"reviews":[{"i":<index>,"safe":true|false,"quality":1-5,"reason":"<short>"}]}.`;

const GEN_RULES = `Rules: two short options (1-3 words), a near 50/50 split, local and specific, confessional where it fits (people answer anonymously), question under 90 characters, casual and witty. Never touch: ${RED_LINES}.
Write each in English and natural Arabic (light Modern Standard Arabic readable in the UAE and Egypt).`;

async function insert(items, { status, source, expiresAt }) {
  let n = 0;
  for (const x of items) {
    if (!x.q_en || !x.a_en || !x.b_en || isDup(x.q_en) || x.q_en.length > 100 || x.a_en.length > 40 || x.b_en.length > 40) continue;
    await db.doc(`questions/${qid(x.q_en)}`).set({
      text: x.q_en, options: [x.a_en, x.b_en], ...(x.q_ar ? { text_ar: x.q_ar, options_ar: [x.a_ar, x.b_ar] } : {}),
      category: x.category, authorUid: 'pulse_originals_system', isPublic: true, groupId: null,
      createdAt: new Date().toISOString(), status, flags: 0, random: Math.random(), boostCount: 0,
      rankTier: 'exploring', source, ...(expiresAt ? { expiresAt } : {}),
    });
    known.push(norm(x.q_en)); n++;
  }
  return n;
}

async function reviewAndKeep(items) {
  const rv = await groq(SAFETY(items.map((x, i) => ({ i, q: x.q_en, a: x.a_en, b: x.b_en, q_ar: x.q_ar }))));
  if (!rv?.reviews) return [];
  return rv.reviews.filter((r) => r.safe === true && r.quality >= 4).map((r) => items[r.i]).filter(Boolean);
}

// ---------- 1. moderate user questions ----------
async function moderate() {
  const pending = await db.collection('questions').where('status', '==', 'pending').limit(100).get();
  for (let i = 0; i < pending.docs.length && timeLeft() > 60000; i += 20) {
    const docs = pending.docs.slice(i, i + 20);
    const items = docs.map((d, j) => ({ i: j, q: d.data().text, a: d.data().options?.[0], b: d.data().options?.[1] }));
    const [g, q] = await Promise.all([gemini(SAFETY(items)), groq(SAFETY(items))]);
    if (!g?.reviews || !q?.reviews) { report.errors.push('moderation: a model was unavailable, left pending'); return; }
    for (const [j, d] of docs.entries()) {
      const a = g.reviews.find((r) => r.i === j), b = q.reviews.find((r) => r.i === j);
      if (a?.safe === true && b?.safe === true) {
        await d.ref.update({ status: 'live', moderatedAt: new Date().toISOString(), moderatedBy: 'ai-daily' }); report.moderated.approved++;
      } else if (a?.safe === false && b?.safe === false) {
        await d.ref.update({ status: 'rejected', rejectionReason: (a.reason || b.reason || 'Not suitable').slice(0, 120), moderatedBy: 'ai-daily' }); report.moderated.rejected++;
      } else report.moderated.held++; // disagreement: the admin decides
    }
  }
}

// ---------- 2. trends ----------
async function trends() {
  for (const market of ['UAE', 'Egypt']) {
    if (timeLeft() < 120000) return;
    const found = await gemini(`Search the web for what young adults in the ${market} are talking about this week (news, pop culture, football, prices, viral moments, events). Then write 6 two-option poll questions about those topics for Pulse, an anonymous polling app. ${GEN_RULES}
Return ONLY a JSON array: [{"category":"<one of ${CATEGORIES.join(' | ')}>","q_en","a_en","b_en","q_ar","a_ar","b_ar","topic":"<the trend>"}].`, { search: true });
    if (!Array.isArray(found)) continue;
    const keep = await reviewAndKeep(found);
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
    report.trends += await insert(keep, { status: 'live', source: `trend-${market.toLowerCase()}`, expiresAt });
  }
}

// ---------- 3. dialect variants ----------
async function dialects() {
  const snap = await db.collection('questions').where('status', '==', 'live').limit(500).get();
  const todo = snap.docs.filter((d) => !d.data().text_ar_gulf && d.data().text).slice(0, 120);
  for (let i = 0; i < todo.length && timeLeft() > 90000; i += 30) {
    const docs = todo.slice(i, i + 30);
    const res = await gemini(`Rewrite each poll question in two Arabic dialects: Gulf (Emirati, as a young person in the UAE would say it) and Egyptian (as a young person in Cairo would say it). Keep options to 1-3 words, keep the meaning and the tone.
Items: ${JSON.stringify(docs.map((d) => ({ id: d.id, q: d.data().text, a: d.data().options[0], b: d.data().options[1] })))}
Return {"<id>":{"gulf":{"q","a","b"},"eg":{"q","a","b"}}}.`);
    if (!res) return;
    for (const d of docs) {
      const r = res[d.id];
      if (!r?.gulf?.q || !r?.eg?.q) continue;
      await d.ref.update({ text_ar_gulf: r.gulf.q, options_ar_gulf: [r.gulf.a, r.gulf.b], text_ar_eg: r.eg.q, options_ar_eg: [r.eg.a, r.eg.b] });
      report.dialects++;
    }
  }
}

// ---------- 4. generate into the pool ----------
async function generate() {
  const top = (await db.collection('questions').where('rankTier', '==', 'top').limit(40).get()).docs.map((d) => d.data());
  const poolSize = (await db.collection('questions').where('status', '==', 'pool').count().get()).data().count;
  if (poolSize >= 300) { log('pool full, skipping generation'); return; }
  for (let round = 0; timeLeft() > 90000 && !allDead() && report.pooled < 300 - poolSize; round++) {
    const category = CATEGORIES[round % CATEGORIES.length];
    const market = round % 2 ? 'Egypt' : 'the UAE';
    const examples = top.filter((q) => q.category === category).slice(0, 5).map((q) => q.text);
    const out = await gemini(`Write 15 NEW two-option poll questions for Pulse, an anonymous polling app, category "${category}", aimed at young adults in ${market}. ${GEN_RULES}
${examples.length ? `These performed best with real users, match their spirit: ${examples.join(' || ')}` : ''}
Return a JSON array: [{"q_en","a_en","b_en","q_ar","a_ar","b_ar"}].`);
    if (!Array.isArray(out)) continue;
    const fresh = out.filter((x) => x.q_en && !isDup(x.q_en)).map((x) => ({ ...x, category }));
    report.generated += fresh.length;
    if (!fresh.length) continue;
    report.pooled += await insert(await reviewAndKeep(fresh), { status: 'pool', source: 'ai-daily' });
  }
}

// ---------- run ----------
known = (await db.collection('questions').select('text').get()).docs.map((d) => norm(d.data().text ?? ''));
for (const [name, fn] of Object.entries({ moderate, trends, dialects, generate })) {
  if (!TASKS.includes(name) || timeLeft() < 30000) continue;
  log(`task ${name}`);
  try { await fn(); } catch (e) { report.errors.push(`${name}: ${String(e.message).slice(0, 160)}`); }
}
report.when = new Date().toISOString();
const md = [`### Pulse daily bot, ${report.when.slice(0, 10)}`,
  `- Moderation: ${report.moderated.approved} approved, ${report.moderated.rejected} rejected, ${report.moderated.held} left for you`,
  `- Trend questions added: ${report.trends}`, `- Dialect versions added: ${report.dialects}`,
  `- New questions: ${report.generated} drafted, ${report.pooled} passed review into the pool`,
  `- Model calls: ${Object.entries(report.calls).map(([m, n]) => `${m} ${n}`).join(', ') || 'none'}`,
  `- Quotas used up: ${report.exhausted.join(', ') || 'none'}`, ...(report.errors.length ? [`- Errors: ${report.errors.slice(0, 5).join('; ')}`] : [])].join('\n');
writeFileSync('daily-report.md', md);
await db.doc('ops/daily').set({ ...report, updatedAt: FieldValue.serverTimestamp() });
console.log(md);
process.exit(0);

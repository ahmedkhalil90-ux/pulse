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
db.settings({ ignoreUndefinedProperties: true });
const DEADLINE = Date.now() + Number(process.env.MAX_MINUTES ?? 14) * 60000;
const TASKS = (process.env.TASKS ?? 'moderate,trends,qotd,knockout,dialects,generate').split(',');
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
    if (dead.has(m) || (search && dead.has(`${m}+search`))) continue;
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, ...(search ? {} : { responseMimeType: 'application/json' }) } };
    if (search) body.tools = [{ google_search: {} }];
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body),
      });
      report.calls[m] = (report.calls[m] ?? 0) + 1;
      if (r.status === 429) { const k = search ? `${m}+search` : m; dead.add(k); report.exhausted.push(k); continue; }
      if (!r.ok) { if (r.status === 404 || r.status === 400) dead.add(search ? `${m}+search` : m); continue; }
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

// Free public headlines (Google News RSS); used when search grounding has no free quota.
async function headlines(market) {
  const url = market === 'Egypt' ? 'https://news.google.com/rss?hl=ar&gl=EG&ceid=EG:ar' : 'https://news.google.com/rss?hl=en-AE&gl=AE&ceid=AE:en';
  try {
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).text();
    return [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()).slice(0, 40);
  } catch { return []; }
}

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
    if (!x || typeof x !== 'object') continue;
    if (!x.q_en || !x.a_en || !x.b_en || isDup(x.q_en) || x.q_en.length > 100 || x.a_en.length > 40 || x.b_en.length > 40) continue;
    await db.doc(`questions/${qid(x.q_en)}`).set({
      text: x.q_en, options: [x.a_en, x.b_en], ...(x.q_ar && x.a_ar && x.b_ar ? { text_ar: x.q_ar, options_ar: [x.a_ar, x.b_ar] } : {}),
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
// Same scoring as src/lib/similar.ts (kept in step by tests/similar.test.ts on the app side).
const STOP = new Set(('do does did you your youre would rather the and for with are is was what which who how have has ever more than think thought '
  + 'about prefer better like any one this that its into from will can should could when where why there their them they get got '
  + 'each every some much many very really just still also '
  + 'هل انت أنت ولا او أو في على من الى إلى عن مع اللي ايه إيه كده ام أم').split(' '));
const stem = (w) => /^[a-z]+$/.test(w) ? w.replace(/(ly|ing|ed|es|s)$/, '') : w;
const toks = (x) => (x || '').toLowerCase().replace(/[\u060c\u061b\u061f\u066a-\u066d\u06d4]/g, ' ').replace(/[^a-z0-9\u0600-\u06ff\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
const optKey = (o) => (o || []).map((x) => toks(x).join(' ')).filter(Boolean).sort().join('|');
const simScore = (a, b) => Math.min(1, jac(toks(a.text), toks(b.text)) + (optKey(a.options) && optKey(a.options) === optKey(b.options) ? 0.25 : 0));

/** Mark pending questions that repeat an existing one; returns those that remain. */
async function dedupePending(docs) {
  const existing = (await db.collection('questions').where('status', 'in', ['live', 'pool']).select('text', 'options').get())
    .docs.map((d) => ({ id: d.id, ...d.data() }));
  const unsure = [], remain = [];
  for (const d of docs) {
    const q = d.data();
    let best = null;
    for (const e of existing) { const sc = simScore(q, e); if (!best || sc > best.sc) best = { e, sc }; }
    if (q.possibleDuplicateOf) { const e = existing.find((x) => x.id === q.possibleDuplicateOf); if (e && (!best || best.e.id !== e.id)) best = { e, sc: Math.max(simScore(q, e), 0.4) }; }
    if (best && best.sc >= 0.6) await markDuplicate(d, best.e.id);
    else if (best && best.sc >= 0.35) unsure.push({ d, e: best.e });
    else remain.push(d);
  }
  // Borderline: ask a model whether people would answer them the same way.
  for (let i = 0; i < unsure.length; i += 20) {
    const batch = unsure.slice(i, i + 20);
    const res = await gemini(`For each pair, are these two poll questions effectively the same question (would people answer both the same way)? Wording, order and language may differ.
${JSON.stringify(batch.map((u, j) => ({ i: j, a: `${u.d.data().text} [${u.d.data().options?.join(' / ')}]`, b: `${u.e.text} [${u.e.options?.join(' / ')}]` })))}
Return {"same":[<indexes of pairs that are the same question>]}.`);
    const same = new Set(res?.same ?? []);
    for (const [j, u] of batch.entries()) same.has(j) ? await markDuplicate(u.d, u.e.id) : remain.push(u.d);
  }
  return remain;
}
async function markDuplicate(d, originalId) {
  await d.ref.update({ status: 'duplicate', duplicateOf: originalId, moderatedAt: new Date().toISOString(), moderatedBy: 'ai-daily' });
  report.moderated.duplicates = (report.moderated.duplicates ?? 0) + 1;
}

async function moderate() {
  const pendingSnap = await db.collection('questions').where('status', '==', 'pending').limit(100).get();
  const pending = { docs: await dedupePending(pendingSnap.docs) };
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
    const ask = (source) => `${source}
Write 6 two-option poll questions for Pulse, an anonymous polling app for young adults in the ${market}, about the topics people are talking about this week (pop culture, football, prices, viral moments, events; skip politics and tragedies). ${GEN_RULES}
Return ONLY a JSON array: [{"category":"<one of ${CATEGORIES.join(' | ')}>","q_en","a_en","b_en","q_ar","a_ar","b_ar","topic":"<the trend>"}].`;
    let found = await gemini(ask(`Search the web for what young adults in the ${market} are talking about this week.`), { search: true });
    if (!Array.isArray(found)) {
      const news = await headlines(market);
      if (news.length) found = await gemini(ask(`This week's top headlines in the ${market}:\n- ${news.join('\n- ')}`));
    }
    if (!Array.isArray(found)) continue;
    const keep = await reviewAndKeep(found);
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
    report.trends += await insert(keep, { status: 'live', source: `trend-${market.toLowerCase()}`, expiresAt });
  }
}

// ---------- 2b. question of the day ----------
// Freshest trend question if there is one (timely, made to be shared), else
// the best-ranked live question that has not been featured in the last 30 days.
async function qotd() {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const recent = new Set(((await db.doc('ops/questionOfDay').get()).data()?.history ?? []).slice(-30));
  const live = (await db.collection('questions').where('status', '==', 'live').where('isPublic', '==', true).get()).docs
    .map((d) => ({ id: d.id, ...d.data() })).filter((q) => !recent.has(q.id));
  const trends = live.filter((q) => q.source?.startsWith('trend-') && q.createdAt >= since);
  const pick = trends.length ? trends[Math.floor(Math.random() * trends.length)]
    : live.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))[0];
  if (!pick) return;
  await db.doc('ops/questionOfDay').set({ id: pick.id, date: new Date().toISOString().slice(0, 10), history: [...recent, pick.id].slice(-30) });
  report.qotd = pick.text;
}

// ---------- 2c. knockout brackets ----------
// One new 8-contender bracket a day, live for 7 days. Member suggestions are
// read as ideas (merged, joke entries dropped by the reviewer), never copied in
// unchecked. A second model must agree it is safe and well-formed.
async function knockout() {
  const live = (await db.collection('brackets').where('status', '==', 'live').get()).docs;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  for (const b of live) if ((b.data().createdAt ?? '') < weekAgo) await b.ref.update({ status: 'closed', closedAt: new Date().toISOString() });
  const newest = live.map((b) => b.data().createdAt ?? '').sort().pop() ?? '';
  if (newest > new Date(Date.now() - 20 * 36e5).toISOString()) { report.knockout = 'already made one today'; return; }

  const past = (await db.collection('brackets').select('title').get()).docs.map((d) => d.data().title).slice(-60);
  const ideaDocs = (await db.collection('bracketSuggestions').limit(200).get()).docs.filter((d) => !d.data().processed).slice(0, 60);
  const ideas = ideaDocs.map((d) => d.data().text);
  for (let attempt = 0; attempt < 3 && !allDead(); attempt++) {
    const draft = await gemini(`Create one "Knockout" bracket for Pulse, an anonymous app for young adults in the UAE and Egypt: a "best of" debate with exactly 8 contenders that people will argue about, e.g. best striker ever, best Ramadan series, best fast-food chain in the UAE, best Amr Diab song.
Contenders must be real, widely known in the UAE and Egypt, distinct (no two spellings of the same thing), and evenly matched so the bracket is a real fight. Names under 30 characters.
Never touch: ${RED_LINES}. No living politicians or religious figures.
Do not repeat these past brackets: ${JSON.stringify(past)}.
${ideas.length ? `Members suggested these ideas (topics or contenders; ignore jokes, duplicates and anything unsafe; use one if it makes a great bracket): ${JSON.stringify(ideas)}` : ''}
Write in English and natural Arabic. Return {"title_en","title_ar","category","contenders":[{"en","ar"} x8]}.`);
    const c = draft?.contenders;
    if (!draft?.title_en || !Array.isArray(c) || c.length !== 8) continue;
    const names = c.map((x) => String(x.en ?? '').trim());
    if (names.some((n) => !n || n.length > 40) || new Set(names.map((n) => n.toLowerCase())).size !== 8) continue;
    const review = await groq(`Review this bracket for an anonymous polling app in the UAE and Egypt. "safe": false if the topic or any contender touches ${RED_LINES}, or a living politician or religious figure, or could offend. "distinct": false if two contenders are the same thing. Bracket: ${JSON.stringify({ title: draft.title_en, contenders: names })}
Return {"safe":true|false,"distinct":true|false,"reason":"<short>"}.`) ?? await gemini(`Review this bracket. "safe": false if it touches ${RED_LINES} or a living politician or religious figure. "distinct": false if two contenders are the same. ${JSON.stringify({ title: draft.title_en, contenders: names })} Return {"safe":true|false,"distinct":true|false}.`);
    if (!review?.safe || !review?.distinct) { report.errors.push(`knockout draft rejected: ${review?.reason ?? 'no review'}`); continue; }
    const order = c.map((x, i) => ({ x, r: Math.random(), i })).sort((a, b) => a.r - b.r).map((o) => o.x);
    const id = 'ko_' + crypto.createHash('sha1').update(draft.title_en + Date.now()).digest('hex').slice(0, 12);
    await db.doc(`brackets/${id}`).set({
      title: draft.title_en.slice(0, 80), title_ar: String(draft.title_ar ?? '').slice(0, 80), category: draft.category ?? 'Would You Rather',
      contenders: order.map((x) => ({ name: String(x.en).trim(), name_ar: String(x.ar ?? '').trim() || undefined })),
      status: 'live', createdAt: new Date().toISOString(), source: 'ai-daily',
    });
    for (const d of ideaDocs) await d.ref.update({ processed: true });
    report.knockout = `${draft.title_en} (${names.join(', ')})`;
    return;
  }
  report.knockout = report.knockout ?? 'no bracket passed review today';
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
for (const [name, fn] of Object.entries({ moderate, trends, qotd, knockout, dialects, generate })) {
  if (!TASKS.includes(name) || timeLeft() < 30000) continue;
  log(`task ${name}`);
  try { await fn(); } catch (e) { report.errors.push(`${name}: ${String(e.message).slice(0, 160)}`); }
}
report.when = new Date().toISOString();
const md = [`### Pulse daily bot, ${report.when.slice(0, 10)}`,
  `- Moderation: ${report.moderated.approved} approved, ${report.moderated.rejected} rejected, ${report.moderated.duplicates ?? 0} merged as duplicates, ${report.moderated.held} left for you`,
  `- Trend questions added: ${report.trends}`, `- Question of the day: ${report.qotd ?? 'unchanged'}`, `- Knockout: ${report.knockout ?? 'not run'}`, `- Dialect versions added: ${report.dialects}`,
  `- New questions: ${report.generated} drafted, ${report.pooled} passed review into the pool`,
  `- Model calls: ${Object.entries(report.calls).map(([m, n]) => `${m} ${n}`).join(', ') || 'none'}`,
  `- Quotas used up: ${report.exhausted.join(', ') || 'none'}`, ...(report.errors.length ? [`- Errors: ${report.errors.slice(0, 5).join('; ')}`] : [])].join('\n');
writeFileSync('daily-report.md', md);
await db.doc('ops/daily').set({ ...report, updatedAt: FieldValue.serverTimestamp() });
console.log(md);
process.exit(0);

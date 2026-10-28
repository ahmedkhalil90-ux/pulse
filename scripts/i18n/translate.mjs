#!/usr/bin/env node
// Translate UI strings and question text to Arabic with free-tier models.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/i18n/translate.mjs ui <strings.json> <out ar.json>
//        NODE_USE_ENV_PROXY=1 node scripts/i18n/translate.mjs questions <seed.json> <out seed-ar.json>
// Keys come from .env.local (GEMINI_API_KEY, GROQ_API_KEY); never printed.
// Resumable: existing entries in the output file are kept.
import fs from 'node:fs';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const [mode, inFile, outFile] = process.argv.slice(2);
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const save = () => fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STYLE = 'Arabic for a casual social polling app for young adults in the UAE and Egypt: natural, light Modern Standard Arabic that reads well in both countries, short and friendly. Not a literal word-for-word translation.';

async function gemini(prompt) {
  for (const model of ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }),
    }).catch(e => ({ ok: false, status: e.message }));
    if (r.ok) { const d = await r.json(); return JSON.parse(d.candidates[0].content.parts.map(p => p.text || '').join('')); }
    console.log(`  ${model}: ${r.status}`);
  }
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt + '\nReturn only json.' }] }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}`);
  return JSON.parse((await r.json()).choices[0].message.content);
}

if (mode === 'ui') {
  const todo = JSON.parse(fs.readFileSync(inFile, 'utf8')).filter(s => !out[s]);
  for (let i = 0; i < todo.length; i += 60) {
    const batch = todo.slice(i, i + 60);
    const res = await gemini(`Translate these app interface strings to ${STYLE}
Keep numbers, emoji, punctuation and leading/trailing spaces as they are. Keep "Pulse" in Latin letters. Credits = نقاط.
Return a JSON object mapping each English string exactly to its Arabic translation.
${JSON.stringify(batch)}`);
    for (const s of batch) if (typeof res[s] === 'string' && res[s].trim()) out[s] = res[s];
    save(); console.log(`ui ${Math.min(i + 60, todo.length)}/${todo.length}`); await sleep(2000);
  }
  console.log(`missing: ${JSON.parse(fs.readFileSync(inFile, 'utf8')).filter(s => !out[s]).length}`);
} else if (mode === 'questions') {
  const qs = JSON.parse(fs.readFileSync(inFile, 'utf8')).questions.filter(q => !out[q.id]);
  for (let i = 0; i < qs.length; i += 40) {
    const batch = qs.slice(i, i + 40).map(q => ({ id: q.id, q: q.question, a: q.option_a, b: q.option_b }));
    const res = await gemini(`Translate these two-option poll questions to ${STYLE}
Options must stay short (1-3 words). Return a JSON object keyed by id: {"<id>": {"q": "...", "a": "...", "b": "..."}}.
${JSON.stringify(batch)}`);
    for (const b of batch) { const r = res[b.id] ?? res[String(b.id)]; if (r?.q && r?.a && r?.b) out[b.id] = r; }
    save(); console.log(`questions ${Math.min(i + 40, qs.length)}/${qs.length}`); await sleep(2000);
  }
}

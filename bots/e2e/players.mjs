#!/usr/bin/env node
/**
 * PLAYER BOTS: two real browsers (Chromium via Playwright) using the app the
 * way people do, against the local emulators. Each step is recorded as
 * pass/fail with a screenshot on failure; browser console errors and crashes
 * are collected. Writes bots/e2e/out/report.json and exits non-zero on any
 * failure.
 *
 * Prereqs (run by bots/run-all.sh): Firestore emulator on 8080, Auth emulator
 * on 9099, `VITE_USE_EMULATOR=1 vite --port 3000` serving the app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'bots/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-applet-config.json'), 'utf8'));

// --- seed: real rules loaded, data written with rules disabled ---
const env = await initializeTestEnvironment({
  projectId: config.projectId,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/pulse_seed_questions.json'), 'utf8')).questions.slice(0, 15);
  for (const q of seed) {
    await setDoc(doc(db, 'questions', `seed_${q.id}`), {
      text: q.question, options: [q.option_a, q.option_b], category: q.category,
      authorUid: 'pulse_originals_system', isPublic: true, createdAt: new Date().toISOString(),
      status: 'live', flags: 0, random: Math.random(),
    });
    // 12 prior votes: enough to open Insights. Age 25-34 holds 11 (shown);
    // 18-24 holds 1 and must never be displayed (min-10 anonymity rule).
    await setDoc(doc(db, 'results', `seed_${q.id}`), {
      counts: { '0': 7, '1': 5 },
      demographics: {
        ageRange: { '25-34': { '0': 6, '1': 5 }, '18-24': { '0': 1, '1': 0 } },
        gender: { Female: { '0': 7, '1': 5 } },
        country: { UAE: { '0': 7, '1': 5 } },
      },
    });
  }
});
async function makeAdmin(username) {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const { getDoc } = await import('firebase/firestore');
    const m = await getDoc(doc(db, 'usernames', username.toLowerCase()));
    if (!m.exists()) throw new Error(`no usernames mapping for ${username}`);
    await setDoc(doc(db, 'admins', m.data().uid), { note: 'bot admin' });
  });
}

const steps = [];
const consoleErrors = [];
const browser = await chromium.launch();

async function newBot(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // phone-sized
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ bot: name, text: m.text().slice(0, 300) }); });
  page.on('pageerror', e => consoleErrors.push({ bot: name, text: `CRASH: ${String(e.message).slice(0, 300)}` }));
  return { name, page };
}

async function step(bot, name, fn) {
  const t0 = Date.now();
  try {
    await fn(bot.page);
    steps.push({ bot: bot.name, step: name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    const shot = path.join(OUT, `${bot.name}-${name.replace(/\W+/g, '_')}.png`);
    await bot.page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    steps.push({ bot: bot.name, step: name, ok: false, ms: Date.now() - t0, error: String(e.message).split('\n')[0].slice(0, 300), screenshot: path.relative(ROOT, shot) });
  }
}
const nav = (page, label) => page.locator('nav').getByText(label, { exact: true }).click();
const credits = async page => Number(await page.locator('svg.lucide-coins + span').first().innerText());
const toast = (page, text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 });

async function signup(bot, username, age, gender, country) {
  await step(bot, 'open app', p => p.goto(APP, { waitUntil: 'networkidle' }));
  await step(bot, 'sign up', async p => {
    await p.getByText("Don't have an account? Sign Up").click();
    await p.getByPlaceholder('Enter your handle...').fill(username);
    await p.getByPlaceholder('Min 6 characters...').fill('botpass123');
    const selects = p.locator('select');
    await selects.nth(0).selectOption(age);
    await selects.nth(1).selectOption(gender);
    await selects.nth(2).selectOption(country);
    await p.getByRole('button', { name: 'Create Account' }).click();
    await toast(p, 'Welcome to Pulse');
  });
}

const run = Date.now().toString(36).slice(-4);
const a = await newBot('alice');
const b = await newBot('bob');

// 1. Onboarding
await signup(a, `alice${run}`, '25-34', 'Female', 'UAE');
await signup(b, `bob${run}`, '18-24', 'Male', 'Egypt');

// 2. Feed: vote, see results and the anonymity confirmation
let creditsBefore = 0;
await step(a, 'vote in feed', async p => {
  creditsBefore = await credits(p);
  const option = p.locator('h3 + div button').first();
  await option.waitFor({ timeout: 10000 });
  await option.click();
  await toast(p, 'Vote recorded anonymously');
});
await step(a, 'anonymity confirmation shown', p => toast(p, 'Your answer is anonymous'));
await step(a, 'credit balance increased', async p => {
  await p.waitForTimeout(1500);
  let after = await credits(p);
  if (after !== creditsBefore + 1) { await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator('svg.lucide-coins + span').first().waitFor(); await p.waitForTimeout(2000); after = await credits(p); if (after === creditsBefore + 1) throw new Error(`top-bar balance stale: showed ${creditsBefore} until reload, then ${after}`); }
  if (after !== creditsBefore + 1) throw new Error(`credits ${creditsBefore} -> ${after} even after reload, expected +1`);
});

await step(a, 'unlock demographics: -3 credits, small groups stay hidden', async p => {
  const before = await credits(p);
  await p.getByRole('button', { name: /Unlock — 3 Credits/ }).first().click();
  const shown = await p.getByText('25-34').first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  const leaked = await p.getByText('18-24').count();
  await toast(p, 'Demographics unlocked');
  await p.waitForTimeout(1500);
  const after = await credits(p);
  if (after !== before - 3) throw new Error(`credits ${before} -> ${after}, expected -3`);
  if (leaked) throw new Error('ANONYMITY: a 1-vote age bucket is displayed (min-10 rule)');
  if (!shown) console.log('  note: feed auto-advanced before the breakdown could be read');
});

// 3. Groups: alice creates, bob joins with the invite code
let inviteCode = '';
await step(a, 'create group', async p => {
  await nav(p, 'Groups');
  await p.getByRole('button', { name: 'Create Group' }).click();
  await p.getByPlaceholder('e.g. The Inner Circle').fill(`Bots ${run}`);
  await p.getByRole('button', { name: /Create/ }).last().click();
  await toast(p, 'Group created');
});
await step(a, 'read invite code', async p => {
  await p.getByText(`Bots ${run}`).first().click();
  await p.getByText('Invite Code').waitFor({ timeout: 10000 });
  const text = await p.locator('body').innerText();
  inviteCode = (text.match(/Invite Code\s*\n?\s*([A-Z0-9]{6})/i) || [])[1] || '';
  if (!inviteCode) throw new Error('invite code not found on group page');
});
await step(b, 'join group by code', async p => {
  if (!inviteCode) throw new Error('skipped: no invite code from alice');
  await nav(p, 'Groups');
  await p.getByRole('button', { name: 'Join Group' }).click();
  await p.getByPlaceholder('XXXXXX').fill(inviteCode);
  await p.getByRole('button', { name: /Join/ }).last().click();
  await p.getByText(`Bots ${run}`).first().waitFor({ timeout: 10000 });
});
await step(b, 'members tab shows count only, no usernames', async p => {
  await p.getByText(`Bots ${run}`).first().click();
  const body = await p.locator('body').innerText();
  if (body.includes(`alice${run}`)) throw new Error('another member\'s username is visible in the group');
});

// 4. Posting: verify phone, post, question held for moderation (no Gemini key in test)
await step(a, 'verify phone', async p => {
  await p.locator('button:has(svg.lucide-user)').first().click();
  await p.getByRole('button', { name: 'Verify Phone Number' }).click();
  await toast(p, 'Phone verified');
});
await step(a, 'post a question', async p => {
  await nav(p, 'Feed');
  await p.locator('nav button').nth(2).click(); // centre "+" button
  await p.getByPlaceholder("What's on your mind?").fill(`Bot test ${run}: karak or flat white?`);
  await p.getByPlaceholder('First choice...').fill('Karak');
  await p.getByPlaceholder('Second choice...').fill('Flat white');
  await p.getByRole('button', { name: 'Publish', exact: true }).click();
  await p.getByText(/passes review|held for review|question live|Failed to publish|Could not save|Rejected/i).first().waitFor({ timeout: 20000 });
  const body = await p.locator('body').innerText();
  if (/Failed to publish|Could not save|Rejected/i.test(body)) throw new Error('posting failed: ' + body.match(/(Failed to publish|Could not save[^\n]*|Rejected[^\n]*)/i)[0]);
});

await step(a, 'admin approves the pending question in the review queue', async p => {
  await makeAdmin(`alice${run}`);
  await p.locator('button:has(svg.lucide-user)').first().click();
  await p.getByText(`Bot test ${run}`).first().waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: /Approve/ }).first().click();
  await toast(p, 'Question approved');
});

// 5. Game mode: alice hosts, bob joins by code
let gameCode = '';
await step(a, 'host a live game', async p => {
  await nav(p, 'Games');
  await p.getByText('Play Live').click();
  await p.getByText('Waiting Lobby').waitFor({ timeout: 10000 });
  const text = await p.locator('body').innerText();
  gameCode = (text.match(/Share this code\s*\n?\s*([A-Z0-9]{6})/i) || [])[1] || '';
  if (!gameCode) throw new Error('game code not visible in lobby');
});
await step(b, 'join game by code', async p => {
  if (!gameCode) throw new Error('skipped: no game code from alice');
  await nav(p, 'Games');
  await p.getByPlaceholder('ENTER 6-CHAR CODE').fill(gameCode);
  await p.getByRole('button', { name: /Join/ }).last().click();
  await p.getByText('Waiting Lobby').waitFor({ timeout: 10000 });
});

// 6. Play the whole game: start, submit questions, answer + predict each, finish
await step(a, 'host starts the game', async p => {
  await p.getByRole('button', { name: /^2$/ }).first().click(); // 2 questions each
  await p.getByRole('button', { name: /Start Game/ }).click();
  await toast(p, 'Game started');
});
async function submitQuestions(bot, tag) {
  await step(bot, 'submit game questions', async p => {
    for (let k = 0; k < 2; k++) {
      await p.getByPlaceholder('e.g. Is a hotdog a sandwich?').fill(`${tag} question ${k}?`);
      await p.getByPlaceholder('Yes').fill(`Opt${tag}${k}A`);
      await p.getByPlaceholder('No').fill(`Opt${tag}${k}B`);
      await p.getByRole('button', { name: /Add Question/ }).click();
    }
    await p.getByRole('button', { name: /Submit All Questions/ }).click();
    await toast(p, 'Questions submitted');
  });
}
await submitQuestions(a, 'A');
await submitQuestions(b, 'B');
await step(a, 'play every question to Game Over', async () => {
  const deadline = Date.now() + 120000;
  const done = { alice: false, bob: false };
  while (Date.now() < deadline && !(done.alice && done.bob)) {
    for (const bot of [a, b]) {
      const p = bot.page;
      const body = await p.locator('body').innerText().catch(() => '');
      if (/Game Over/i.test(body)) { done[bot.name] = true; continue; }
      if (/Step 1: Answer Honestly/i.test(body)) {
        await p.locator('button:has-text("Opt")').first().click().catch(() => {});
      } else if (/Step 2: Predict the Group/i.test(body)) {
        await p.getByText('Predict Option A').first().click().catch(() => {});
      } else if (bot === a) {
        const next = p.getByRole('button', { name: /Next Question|Finish Game/ });
        if (await next.count()) await next.first().click().catch(() => {});
      }
    }
    await a.page.waitForTimeout(700);
  }
  if (!(done.alice && done.bob)) {
    await env.withSecurityRulesDisabled(async ctx => {
      const { getDocs, collection } = await import('firebase/firestore');
      const db = ctx.firestore();
      const games = await getDocs(collection(db, 'games'));
      const qs = new Set((await getDocs(collection(db, 'game_questions'))).docs.map(d => d.id));
      for (const g of games.docs) {
        const d = g.data();
        fs.writeFileSync(path.join(OUT, 'game-debug.json'), JSON.stringify({ id: g.id, status: d.status, idx: d.currentQuestionIndex, questions: d.questions, missing: (d.questions || []).filter(q => !qs.has(q)), playerQuestions: d.playerQuestions, answers: d.answers, predictions: d.predictions, qpp: d.questionsPerPlayer }, null, 1));
      }
    });
    throw new Error(`game did not finish for: ${Object.entries(done).filter(([, v]) => !v).map(([k]) => k).join(', ')}`);
  }
});
await step(a, 'final leaderboard shown, no individual answers', async p => {
  const body = await p.locator('body').innerText();
  if (!/Final Leaderboard/i.test(body)) throw new Error('no final leaderboard');
  if (new RegExp(`bob${run}[^\\n]{0,40}(picked|answered|chose)`, 'i').test(body)) throw new Error('ANONYMITY: another player\'s answer is shown');
});

await browser.close();
await env.cleanup();

const failed = steps.filter(s => !s.ok);
const report = { when: new Date().toISOString(), passed: steps.length - failed.length, failed: failed.length, steps, consoleErrors: consoleErrors.slice(0, 50) };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`player bots: ${report.passed} passed, ${report.failed} failed, ${consoleErrors.length} console errors`);
for (const f of failed) console.log(`  FAIL [${f.bot}] ${f.step}: ${f.error}`);
process.exit(failed.length ? 1 : 0);

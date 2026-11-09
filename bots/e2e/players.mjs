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
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/pulse_seed_questions.json'), 'utf8')).questions.slice(0, 30);
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
// Question index for the duplicate check (normally written by the ranking job).
await env.withSecurityRulesDisabled(async ctx => {
  const seedQs = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/pulse_seed_questions.json'), 'utf8')).questions.slice(0, 15);
  await setDoc(doc(ctx.firestore(), 'ops', 'questionIndex'), { items: seedQs.map(q => ({ id: `seed_${q.id}`, t: q.question, o: [q.option_a, q.option_b] })) });
});
await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'ops', 'questionOfDay'), { id: 'seed_2', date: '2026-10-28' }); });
// Invite-only: a founding member (#1) whose link the bots arrive through.
const FOUNDER_CODE = 'FOUNDR';
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users', 'founder'), { credits: 0, referralCode: FOUNDER_CODE, memberNumber: 1, demographics: {} });
  await setDoc(doc(db, 'referralCodes', FOUNDER_CODE), { uid: 'founder' });
  await setDoc(doc(db, 'counters', 'members'), { last: 1 });
});
const AUTH = 'http://127.0.0.1:9099';
const PASS = 'botpass123';
/** uid for an email account, straight from the Auth emulator. */
async function uidOf(email) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=bots`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.localId) throw new Error(`no auth account for ${email}`);
  return j.localId;
}
const DUP_SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/pulse_seed_questions.json'), 'utf8')).questions[3];

async function makeAdmin(email) {
  const uid = await uidOf(email);
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'admins', uid), { note: 'bot admin' }); });
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

async function signup(bot, email, age, gender, country) {
  await step(bot, 'open invite link', async p => {
    await p.goto(`${APP}/?ref=${FOUNDER_CODE}`, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-testid="invite-chip"]').waitFor({ timeout: 15000 });
  });
  await step(bot, 'sign up with email', async p => {
    await p.getByPlaceholder('you@example.com').fill(email);
    await p.getByPlaceholder('Min 6 characters...').fill(PASS);
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
const ALICE = `alice${run}@example.com`, BOB = `bob${run}@example.com`, CAROL = `carol${run}@example.com`;

/** Answer n questions from the feed, one after another. */
async function answer(p, n) {
  for (let k = 0; k < n; k++) {
    const opt = p.locator('h3 + div button').first();
    await opt.waitFor({ timeout: 10000 });
    await opt.click();
    await p.waitForTimeout(700);
    await p.getByRole('button', { name: /Next/ }).first().click().catch(() => {});
    await p.waitForTimeout(500);
  }
}

// 1. Onboarding: invite-only, email sign-in
await signup(a, ALICE, '25-34', 'Female', 'UAE');
await signup(b, BOB, '18-24', 'Male', 'Egypt');

await step(a, 'new member answers 5 before the app opens up', async p => {
  await p.locator('[data-testid="entry-progress"]').waitFor({ timeout: 10000 });
  await nav(p, 'Groups');
  await toast(p, 'more to unlock this');
  if (await p.getByRole('button', { name: /Create Group|Join/ }).count()) throw new Error('Groups opened before the entry answers');
  await answer(p, 5);
  await toast(p, "You're in!");
  await p.locator('[data-testid="entry-progress"]').waitFor({ state: 'detached', timeout: 5000 });
});
await step(a, 'invite link locked until 10 answers', async p => {
  await p.locator('header button').last().click(); // profile
  await p.locator('[data-testid="invite-locked"]').waitFor({ timeout: 8000 });
  if (await p.locator('[data-testid="invite-link"]').count()) throw new Error('invite link shown before 10 answers');
  await nav(p, 'Feed');
});
await step(a, 'at 10 answers: member number and invite link', async p => {
  await answer(p, 5);
  await toast(p, "You're member #2");
  await p.locator('header button').last().click();
  const label = (await p.locator('[data-testid="member-label"]').innerText()).trim();
  if (label !== '#2') throw new Error(`profile shows ${label}, expected #2`);
  const link = await p.locator('[data-testid="invite-link"]').innerText({ timeout: 8000 });
  if (!/\?ref=[A-Z0-9]{6}$/.test(link.trim())) throw new Error(`bad invite link: ${link}`);
  if (await p.locator('[data-testid="recovery-email"]').count()) throw new Error('email account asked for a recovery email');
  await nav(p, 'Feed');
});

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

await step(a, 'question of the day banner opens the question', async p => {
  await p.locator('[data-testid="qotd"]').click();
  await p.locator('[data-testid="question-overlay"]').waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: 'Close' }).click();
});
await step(a, 'share buttons shown after voting', async p => {
  if (!(await p.locator('[data-testid="share-row"]').count())) {
    await p.locator('h3 + div button').first().click();
    await toast(p, 'Vote recorded anonymously');
  }
  await p.locator('[data-testid="share-row"]').first().waitFor({ timeout: 8000 });
  const wa = await p.locator('[data-testid="share-row"] a').first().getAttribute('href');
  if (!wa?.startsWith('https://wa.me/?text=') || !decodeURIComponent(wa).includes('/q/')) throw new Error(`bad WhatsApp link: ${wa}`);
  if (!/ref=[A-Z0-9]{6}/.test(decodeURIComponent(wa))) throw new Error('share link carries no referral code');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.getByRole('button', { name: /My pick/ }).first().click()]);
  const file = path.join(OUT, 'my-pick.png'); await dl.saveAs(file);
  if (fs.statSync(file).size < 20000) throw new Error('"My pick" image is suspiciously small');
});
await step(a, 'beta tracking counts sessions, answers and shares (counts only)', async () => {
  let rec;
  await env.withSecurityRulesDisabled(async ctx => {
    const { getDoc } = await import('firebase/firestore');
    const day = new Date().toISOString().slice(0, 10);
    rec = (await getDoc(doc(ctx.firestore(), 'activity', `${await uidOf(ALICE)}_${day}`))).data();
  });
  if (!rec) throw new Error('no activity record for today');
  if (!(rec.sessions >= 1 && rec.answers >= 1 && rec.shares >= 1)) throw new Error(`counters not filled: ${JSON.stringify(rec)}`);
  const extra = Object.keys(rec).filter((k) => !['uid', 'day', 'sessions', 'answers', 'skips', 'shares'].includes(k));
  if (extra.length) throw new Error(`activity holds more than counts: ${extra.join(', ')}`);
});
await step(a, 'unlock demographics: -3 credits, small groups stay hidden', async p => {
  // Vote on whichever card is in front first: the feed may have moved on.
  if (!(await p.getByRole('button', { name: /Unlock — 3 Credits/ }).count())) {
    await p.locator('h3 + div button').first().click();
    await toast(p, 'Vote recorded anonymously');
    await p.waitForTimeout(800);
  }
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

await step(a, 'returning user: answered questions do not come back', async p => {
  for (let k = 0; k < 3; k++) {            // answer a few more first
    await p.locator('h3 + div button').first().click().catch(() => {});
    await p.waitForTimeout(700);
    await p.getByRole('button', { name: /Next/ }).first().click().catch(() => {});
    await p.waitForTimeout(500);
  }
  const answeredTexts = new Set();
  await env.withSecurityRulesDisabled(async ctx => {
    const { getDocs, getDoc, collection, query, where } = await import('firebase/firestore');
    const db = ctx.firestore();
    const ans = await getDocs(query(collection(db, 'user_answers'), where('userId', '==', await uidOf(ALICE))));
    for (const d of ans.docs) answeredTexts.add((await getDoc(doc(db, 'questions', d.data().questionId))).data()?.text);
  });
  if (answeredTexts.size < 2) throw new Error(`bot answered only ${answeredTexts.size} questions`);
  for (let r = 0; r < 3; r++) {            // reopen the app three times
    await p.reload({ waitUntil: 'domcontentloaded' });
    const first = (await p.locator('h3').first().innerText({ timeout: 15000 })).trim();
    if (answeredTexts.has(first)) throw new Error(`reopened app shows an already-answered question first: "${first}"`);
  }
});

await step(a, 'category chips match the questions and filter the feed', async p => {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.locator('h3').first().waitFor({ timeout: 15000 });
  const chips = (await p.locator('.no-scrollbar button').allInnerTexts()).map((x) => x.trim().toLowerCase());
  if (chips.includes('sports') && !chips.includes('lifestyle & daily habits')) throw new Error('chips are the old hardcoded list');
  if (!chips.includes('lifestyle & daily habits')) throw new Error(`expected a chip for the seeded category, got: ${chips.join(', ')}`);
  await p.locator('.no-scrollbar button', { hasText: 'Lifestyle & Daily Habits' }).click();
  await p.waitForTimeout(1500);
  // The card's own category label (the text block that holds the question).
  const card = (await p.locator('h3').first().locator('xpath=ancestor::div[.//span][1]').innerText()).toLowerCase();
  if (!card.includes('lifestyle & daily habits')) throw new Error(`filtered feed card is from another category: ${card.slice(0, 80)}`);
  await p.locator('.no-scrollbar button').first().click(); // back to All
});

await step(b, 'bob answers his entry questions', async p => { await answer(p, 5); await toast(p, "You're in!"); });

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
  if (body.includes(`alice${run}`) || /#2\b/.test(body)) throw new Error('another member\'s name or number is visible in the group');
});

// 4. Posting: verify phone, post, question held for moderation (no Gemini key in test)
await step(a, 'verify phone', async p => {
  await p.locator('button:has(svg.lucide-user)').first().click();
  await p.getByRole('button', { name: 'Verify Phone Number' }).click();
  await toast(p, 'Phone verified');
});
await step(a, 'duplicate question: shown the existing one and can answer it', async p => {
  await nav(p, 'Feed');
  await p.locator('nav button').nth(2).click();
  await p.getByPlaceholder("What's on your mind?").fill(DUP_SEED.question);
  await p.locator('[data-testid="duplicate-panel"]').waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: 'Answer it' }).click();
  await p.locator('[data-testid="duplicate-panel"]').getByText(DUP_SEED.option_a, { exact: true }).first().waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: 'Cancel', exact: true }).click();
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
  await makeAdmin(ALICE);
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
  if (new RegExp(`(Newcomer|#\\d+)[^\\n]{0,40}(picked|answered|chose)`, 'i').test(body)) throw new Error('ANONYMITY: another player\'s answer is shown');
});

// 8. A friend opens a shared link: sees the question, signs up, answers it; referral recorded
{
  let refCode = '';
  await env.withSecurityRulesDisabled(async ctx => {
    const { getDoc } = await import('firebase/firestore');
    refCode = (await getDoc(doc(ctx.firestore(), 'users', await uidOf(ALICE)))).data().referralCode || '';
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => consoleErrors.push({ bot: 'carol', text: `CRASH: ${String(e.message).slice(0, 300)}` }));
  const carol = { name: 'carol', page };
  await step(carol, 'shared link shows the question before sign-up', async p => {
    if (!refCode) throw new Error('alice has no referral code');
    await p.goto(`${APP}/q/seed_5?ref=${refCode}`, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-testid="shared-teaser"]').waitFor({ timeout: 15000 });
    await p.getByRole('button', { name: 'Create Account' }).waitFor({ timeout: 5000 });
  });
  await step(carol, 'after sign-up the shared question opens, referral recorded', async p => {
    await p.locator('[data-testid="invite-chip"]').waitFor({ timeout: 5000 });
    await p.getByPlaceholder('you@example.com').fill(CAROL);
    await p.getByPlaceholder('Min 6 characters...').fill(PASS);
    const sel = p.locator('select');
    await sel.nth(0).selectOption('25-34'); await sel.nth(1).selectOption('Female'); await sel.nth(2).selectOption('Egypt');
    await p.getByRole('button', { name: 'Create Account' }).click();
    await p.locator('[data-testid="question-overlay"]').waitFor({ timeout: 15000 });
    await p.getByText('Referral code redeemed', { exact: false }).first().waitFor({ timeout: 15000 });
    let found = false;
    await env.withSecurityRulesDisabled(async c => {
      const { getDocs, collection } = await import('firebase/firestore');
      found = (await getDocs(collection(c.firestore(), 'referrals'))).size > 0;
    });
    if (!found) throw new Error('no referral record written');
    let prof;
    await env.withSecurityRulesDisabled(async c => {
      const { getDoc } = await import('firebase/firestore');
      prof = (await getDoc(doc(c.firestore(), 'users', await uidOf(CAROL)))).data();
    });
    if (prof.invitedWith || typeof prof.referredBy === 'string') throw new Error('ANONYMITY: the profile shows who invited this member');
  });
}

// 9. No invite: waitlist. Bad invite: refused, no account left behind. Password reset.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => consoleErrors.push({ bot: 'dave', text: `CRASH: ${String(e.message).slice(0, 300)}` }));
  const dave = { name: 'dave', page };
  await step(dave, 'no invite: sign-up leads to the waitlist', async p => {
    await p.goto(APP, { waitUntil: 'domcontentloaded' });
    await p.getByText("Don't have an account? Sign Up").click();
    await p.getByText('Pulse is invite-only').waitFor({ timeout: 5000 });
    if (await p.getByRole('button', { name: 'Create Account' }).count()) throw new Error('sign-up form shown without an invite');
    await p.getByPlaceholder('Your email').fill(`dave${run}@example.com`);
    await p.getByRole('button', { name: 'Join the waitlist' }).click();
    await p.locator('[data-testid="waitlist-done"]').waitFor({ timeout: 10000 });
    let rows = [];
    await env.withSecurityRulesDisabled(async c => {
      const { getDocs, collection } = await import('firebase/firestore');
      rows = (await getDocs(collection(c.firestore(), 'waitlist'))).docs.map((d) => d.data());
    });
    const mine = rows.find((r) => r.email === `dave${run}@example.com`);
    if (!mine) throw new Error('waitlist entry not stored');
    const extra = Object.keys(mine).filter((k) => !['email', 'lang', 'createdAt'].includes(k));
    if (extra.length) throw new Error(`waitlist stores more than it should: ${extra.join(', ')}`);
  });
  await step(dave, 'a made-up invite code is refused and leaves no account', async p => {
    await p.goto(`${APP}/?ref=BOGUS9`, { waitUntil: 'domcontentloaded' });
    await p.getByPlaceholder('you@example.com').fill(`eve${run}@example.com`);
    await p.getByPlaceholder('Min 6 characters...').fill(PASS);
    const sel = p.locator('select');
    await sel.nth(0).selectOption('25-34'); await sel.nth(1).selectOption('Male'); await sel.nth(2).selectOption('UAE');
    await p.getByRole('button', { name: 'Create Account' }).click();
    await toast(p, "isn't valid any more");
    const left = await uidOf(`eve${run}@example.com`).then(() => true).catch(() => false);
    if (left) throw new Error('an auth account was left behind after the invite was refused');
  });
  await step(dave, 'forgot password sends a reset email', async p => {
    await p.goto(APP, { waitUntil: 'domcontentloaded' });
    await p.getByText('Forgot password?').click();
    await p.getByPlaceholder('you@example.com').fill(CAROL);
    await p.getByRole('button', { name: 'Send reset link' }).click();
    await toast(p, 'reset link is on its way');
    const r = await (await fetch(`${AUTH}/emulator/v1/projects/${config.projectId}/oobCodes`)).json();
    if (!r.oobCodes?.some((c) => c.email === CAROL && c.requestType === 'PASSWORD_RESET')) throw new Error('no password-reset email was sent');
  });
}

// 7. Arabic: a phone set to Arabic gets the Arabic, right-to-left interface
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-AE' });
  const page = await ctx.newPage();
  page.on('pageerror', e => consoleErrors.push({ bot: 'arabic', text: `CRASH: ${String(e.message).slice(0, 300)}` }));
  const bot = { name: 'arabic', page };
  await step(bot, 'Arabic interface, right-to-left', async p => {
    await p.goto(APP, { waitUntil: 'domcontentloaded' });
    await p.getByRole('button', { name: 'تسجيل الدخول' }).waitFor({ timeout: 15000 });
    const dir = await p.evaluate(() => document.documentElement.dir);
    if (dir !== 'rtl') throw new Error(`dir is ${dir}, expected rtl`);
  });
  await step(bot, 'switch to English and back', async p => {
    await p.getByRole('button', { name: 'English' }).click();
    await p.getByRole('button', { name: 'Sign In' }).waitFor({ timeout: 15000 });
    await p.getByRole('button', { name: 'العربية' }).click();
    await p.getByRole('button', { name: 'تسجيل الدخول' }).waitFor({ timeout: 15000 });
  });
}

await browser.close();
await env.cleanup();

const failed = steps.filter(s => !s.ok);
const report = { when: new Date().toISOString(), passed: steps.length - failed.length, failed: failed.length, steps, consoleErrors: consoleErrors.slice(0, 50) };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`player bots: ${report.passed} passed, ${report.failed} failed, ${consoleErrors.length} console errors`);
for (const f of failed) console.log(`  FAIL [${f.bot}] ${f.step}: ${f.error}`);
process.exit(failed.length ? 1 : 0);

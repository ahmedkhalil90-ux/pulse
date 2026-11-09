#!/usr/bin/env node
/**
 * Installable app check: serves the production build (vite preview) and
 * confirms Chromium sees a valid web app manifest and an active service
 * worker, so "Add to Home Screen" / "Install" is offered on phones.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173';
const fails = [];
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(URL, { waitUntil: 'load' });
const m = await p.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
  const man = href ? await (await fetch(href)).json() : null;
  const reg = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]);
  return { man, reg };
});
if (!m.man) fails.push('no manifest linked');
else {
  if (m.man.display !== 'standalone') fails.push('manifest display is not standalone');
  if (!m.man.icons?.some((i) => i.sizes === '512x512')) fails.push('no 512px icon');
  if (!m.man.icons?.some((i) => i.purpose === 'maskable')) fails.push('no maskable icon');
  for (const i of m.man.icons ?? []) { const r = await p.request.get(new globalThis.URL(i.src, URL).toString()); if (!r.ok()) fails.push(`icon missing: ${i.src}`); }
}
if (!m.reg) fails.push('service worker did not activate');
await b.close();
console.log(`installable: ${fails.length ? fails.join('; ') : 'manifest and service worker OK'}`);
process.exit(fails.length ? 1 : 0);

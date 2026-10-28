/**
 * Minimal i18n. English source strings are the keys; ar.json maps them to
 * Arabic. The language is read once at load, and switching reloads the page,
 * so every component picks it up without plumbing a context through.
 */
import ar from '../locales/ar.json';

export type Lang = 'en' | 'ar';
const KEY = 'pulse.lang';

function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch { /* storage unavailable */ }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('ar') ? 'ar' : 'en';
}

export const lang: Lang = readLang();
const dict = ar as Record<string, string>;

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function t(s: string): string {
  return lang === 'ar' ? dict[s] ?? s : s;
}

export function setLang(next: Lang) {
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  window.location.reload();
}

/** Question text in the reader's language, falling back to English. */
export function qText(q: { text: string; text_ar?: string }): string {
  return lang === 'ar' && q.text_ar ? q.text_ar : q.text;
}
export function qOptions(q: { options: string[]; options_ar?: string[] }): string[] {
  return lang === 'ar' && q.options_ar?.length === 2 ? q.options_ar : q.options;
}

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

const GULF = new Set(['UAE', 'Saudi Arabia', 'Kuwait', 'Qatar', 'Bahrain', 'Oman']);
type QText = {
  text: string; options: string[];
  text_ar?: string; options_ar?: string[];
  text_ar_gulf?: string; options_ar_gulf?: string[];
  text_ar_eg?: string; options_ar_eg?: string[];
};
/** Which Arabic version suits the reader: Gulf, Egyptian, or neutral. */
function variant(q: QText, country?: string): [string | undefined, string[] | undefined] {
  if (country && GULF.has(country) && q.text_ar_gulf) return [q.text_ar_gulf, q.options_ar_gulf];
  if (country === 'Egypt' && q.text_ar_eg) return [q.text_ar_eg, q.options_ar_eg];
  return [q.text_ar, q.options_ar];
}
/** Question text in the reader's language (and dialect), falling back to English. */
export function qText(q: QText, country?: string): string {
  const [t] = variant(q, country);
  return lang === 'ar' && t ? t : q.text;
}
export function qOptions(q: QText, country?: string): string[] {
  const [, o] = variant(q, country);
  return lang === 'ar' && o?.length === 2 ? o : q.options;
}

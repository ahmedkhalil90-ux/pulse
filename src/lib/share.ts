import type { Question } from '../types';
import { t, qText, qOptions, lang } from './i18n';

/** Link that opens one question directly, carrying the sharer's referral code. */
export function questionUrl(id: string, refCode?: string): string {
  const u = new URL(`/q/${encodeURIComponent(id)}`, window.location.origin);
  if (refCode) u.searchParams.set('ref', refCode);
  return u.toString();
}

export function shareText(q: Question, country?: string): string {
  const [a, b] = qOptions(q, country);
  return `${qText(q, country)}\n${a} ${t('or')} ${b}? 🤔\n${t('Answer anonymously and see what everyone picked')} 👉`;
}

export const whatsappUrl = (text: string, url: string) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;

/** Native share sheet on phones; falls back to copying the link. */
export async function shareLink(text: string, url: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (navigator.share) {
    try { await navigator.share({ title: 'Pulse', text, url }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  await navigator.clipboard?.writeText(`${text} ${url}`);
  return 'copied';
}

/**
 * "Share my pick": a 1080x1920 story image, drawn on the phone. Only ever made
 * from the user's own answer, at their request; it carries no identifier.
 */
export async function pickCard(question: string, pick: string, agreePct: number, url: string): Promise<Blob> {
  const W = 1080, H = 1920;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#000'); g.addColorStop(1, '#1e1b4b');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.direction = lang === 'ar' ? 'rtl' : 'ltr';
  x.textAlign = 'center'; x.fillStyle = '#fff';
  const font = (px: number, weight = 700) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif`;
  const wrap = (text: string, y: number, px: number, max = 900) => {
    x.font = font(px); const words = text.split(' '); let line = ''; const lines: string[] = [];
    for (const w of words) { const test = line ? `${line} ${w}` : w; if (x.measureText(test).width > max && line) { lines.push(line); line = w; } else line = test; }
    if (line) lines.push(line);
    lines.forEach((l, i) => x.fillText(l, W / 2, y + i * px * 1.25));
    return y + lines.length * px * 1.25;
  };
  x.font = font(56, 800); x.fillText('PULSE', W / 2, 220);
  let y = wrap(question, 620, 76);
  x.fillStyle = '#a5b4fc'; x.font = font(48, 600); x.fillText(t('I picked'), W / 2, y + 140);
  x.fillStyle = '#fff'; y = wrap(pick, y + 260, 110);
  x.fillStyle = '#a5b4fc'; x.font = font(64, 700);
  x.fillText(`${agreePct}% ${t('agree with me')}`, W / 2, y + 120);
  x.fillStyle = '#71717a'; x.font = font(40, 500);
  x.fillText(t('Answer anonymously on Pulse'), W / 2, H - 260);
  x.fillText(new URL(url).host, W / 2, H - 190);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

export async function sharePick(blob: Blob, text: string, url: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], 'pulse-pick.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text: `${text} ${url}` }); return 'shared'; } catch { /* cancelled */ }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pulse-pick.png'; a.click();
  return 'downloaded';
}

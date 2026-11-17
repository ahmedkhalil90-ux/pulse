import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { Flame, Snowflake, Sparkles, Target, Globe2, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../lib/firebase';
import { t } from '../lib/i18n';
import { useAuth } from './AuthProvider';
import { buyStreakFreeze, InsufficientCreditsError, MAX_FREEZES, CREDIT_VALUES } from '../lib/credits';
import { mindMode, mindRef, regionSplit, weekKey, type MindScore } from '../lib/mind';
import { recapCard, sharePick } from '../lib/share';
import { inviteUrl, memberLabel } from '../lib/member';
import { track } from '../lib/activity';

export const DAILY_GOAL = 10;

/** Header chip: consecutive days checked in. */
export function StreakChip() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center gap-1 bg-zinc-900/50 px-2 py-1.5 rounded-full border border-white/5" data-testid="streak-chip" title={t("Day streak")}>
      <Flame className="w-4 h-4 text-orange-400" />
      <span className="text-sm font-bold tabular-nums">{user.streak || 1}</span>
    </div>
  );
}

/** Profile: streak, freezes, and buying a freeze. */
export function StreakCard() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const freezes = user.freezes ?? 0;
  const buy = async () => {
    setBusy(true);
    try {
      await buyStreakFreeze(db, user.uid);
      toast.success(t("Streak freeze added. -5 Credits"));
    } catch (e) {
      if (e instanceof InsufficientCreditsError) toast.error(t("You need 5 credits for a streak freeze. Answer a few questions to earn them."));
      else toast.error(t("Couldn't buy a freeze. Try again."));
    } finally { setBusy(false); }
  };
  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-4" data-testid="streak-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Flame className="w-7 h-7 text-orange-400" />
          <div>
            <p className="text-2xl font-bold tabular-nums">{user.streak || 1} <span className="text-sm font-medium text-zinc-400">{t("day streak")}</span></p>
            <p className="text-xs text-zinc-500">{t("Open Pulse every day to keep it going.")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-sky-300" title={t("Streak freezes")}>
          <Snowflake className="w-4 h-4" /><span className="text-sm font-bold tabular-nums" data-testid="freeze-count">{freezes}/{MAX_FREEZES}</span>
        </div>
      </div>
      {freezes < MAX_FREEZES && (
        <button onClick={buy} disabled={busy} data-testid="buy-freeze"
          className="w-full h-11 rounded-xl border border-sky-500/30 text-sky-300 text-sm font-bold hover:bg-sky-500/10 disabled:opacity-50">
          {t("Get a streak freeze")} · {-CREDIT_VALUES.STREAK_FREEZE} {t("Credits")}
        </button>
      )}
      <p className="text-[11px] text-zinc-600">{t("A freeze saves your streak if you miss one day. It is used automatically.")}</p>
    </div>
  );
}

function useMindMode(): boolean {
  const [on, setOn] = useState(mindMode.get);
  useEffect(() => {
    const f = () => setOn(mindMode.get());
    window.addEventListener('pulse:mind', f);
    return () => window.removeEventListener('pulse:mind', f);
  }, []);
  return on;
}
export { useMindMode };

/** This week's Mind Reader score (private). */
export function useMindScore(uid: string | undefined): MindScore | null {
  const [score, setScore] = useState<MindScore | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(mindRef(db, uid), (s) => setScore(s.exists() && s.data().week === weekKey() ? (s.data() as MindScore) : null), () => {});
  }, [uid]);
  return score;
}

/** Feed strip: today's goal and the Mind Reader switch. */
export function FeedExtras() {
  const { user } = useAuth();
  const on = useMindMode();
  const score = useMindScore(user?.uid);
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => {
    if (!user) return;
    const day = new Date().toISOString().slice(0, 10);
    getDoc(doc(db, 'activity', `${user.uid}_${day}`)).then((s) => setToday(s.data()?.answers ?? 0)).catch(() => setToday(0));
    const bump = () => setToday((n) => {
      const next = (n ?? 0) + 1;
      if (next === DAILY_GOAL) toast.success(t("Daily goal done! 🎯"));
      return next;
    });
    window.addEventListener('pulse:answered', bump);
    return () => window.removeEventListener('pulse:answered', bump);
  }, [user?.uid]);
  if (!user) return null;
  const n = Math.min(today ?? 0, DAILY_GOAL);
  return (
    <div className="flex items-stretch gap-2" data-testid="feed-extras">
      <div className="flex-1 rounded-2xl border border-white/5 bg-zinc-900/40 px-3 py-2 space-y-1.5" data-testid="daily-goal">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {t("Today's goal")}</span>
          <span className="tabular-nums">{n}/{DAILY_GOAL}{n >= DAILY_GOAL ? ' ✓' : ''}</span>
        </div>
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${(n / DAILY_GOAL) * 100}%` }} /></div>
      </div>
      <button onClick={() => { mindMode.set(!on); toast(on ? t("Mind Reader off") : t("Mind Reader on: guess what most people picked before you see the result.")); }}
        data-testid="mind-toggle" aria-pressed={on}
        className={`rounded-2xl border px-3 py-2 text-left ${on ? 'border-violet-500/40 bg-violet-500/15' : 'border-white/5 bg-zinc-900/40'}`}>
        <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest ${on ? 'text-violet-300' : 'text-zinc-500'}`}><Sparkles className="w-3 h-3" /> {t("Mind Reader")}</span>
        <span className="block text-xs font-bold tabular-nums">{on ? (score ? `${score.right}/${score.total}` : t("On")) : t("Off")}</span>
      </button>
    </div>
  );
}

/** Shown over a card after voting, before the result: what did most people pick? */
export function PredictOverlay({ options, onGuess, onSkip }: { options: string[]; onGuess: (i: 0 | 1) => void; onSkip: () => void }) {
  return (
    <div className="absolute inset-0 z-40 bg-zinc-950/95 backdrop-blur-sm rounded-3xl flex items-center justify-center p-6 text-center" data-testid="predict-overlay">
      <div className="space-y-5 w-full max-w-[280px]">
        <Sparkles className="w-8 h-8 text-violet-400 mx-auto" />
        <div className="space-y-1">
          <h3 className="text-lg font-bold">{t("What did most people pick?")}</h3>
          <p className="text-xs text-zinc-500">{t("Your vote is in. Guess before you see the result.")}</p>
        </div>
        <div className="space-y-2">
          {options.map((o, i) => (
            <button key={i} onClick={() => onGuess(i as 0 | 1)} data-testid="predict-option"
              className="w-full px-5 py-3 rounded-xl bg-violet-500/10 border border-violet-500/30 text-sm font-bold hover:bg-violet-500/20">{o}</button>
          ))}
          <button onClick={onSkip} className="w-full py-2 text-xs font-bold text-zinc-500 hover:text-white">{t("Skip")}</button>
        </div>
      </div>
    </div>
  );
}

/** "Gulf said X, Egypt said Y": only when each side has at least 10 answers. */
export function RegionSplitCard({ country, options }: { country: Record<string, Record<string, number>> | undefined; options: string[] }) {
  const r = regionSplit(country);
  if (!r) return null;
  const row = (label: string, s: { lead: 0 | 1 | null; pct: number }) => (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="font-bold">{s.lead === null ? t("Perfectly divided") : `${s.pct}% ${options[s.lead]}`}</span>
    </div>
  );
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2" data-testid="region-split">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
        <Globe2 className="w-3.5 h-3.5" /> {r.split ? t("Gulf and Egypt disagree") : t("Gulf vs Egypt")}
      </p>
      {row(t("Gulf"), r.gulf)}
      {row(t("Egypt"), r.egypt)}
    </div>
  );
}

/** Profile: "My week on Pulse" story image, from the member's own answers. */
export function RecapButton() {
  const { user } = useAuth();
  const score = useMindScore(user?.uid);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const make = async () => {
    setBusy(true);
    try {
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const mine = (await getDocs(query(collection(db, 'user_answers'), where('userId', '==', user.uid)))).docs
        .map((d) => d.data()).filter((a) => (a.answeredAt ?? '') >= since);
      const judged = mine.filter((a) => typeof a.option0PercentAtTime === 'number' && a.option0PercentAtTime !== 50);
      const agreed = judged.filter((a) => (a.answerIndex === 0 ? a.option0PercentAtTime : a.option1PercentAtTime) > 50).length;
      const url = user.memberNumber && user.referralCode ? inviteUrl(user.referralCode) : window.location.origin;
      const blob = await recapCard({
        answers: mine.length, agreePct: judged.length >= 5 ? Math.round((agreed / judged.length) * 100) : null,
        streak: user.streak || 1, mind: score ? { right: score.right, total: score.total } : null, member: memberLabel(user),
      }, url);
      const r = await sharePick(blob, t("My week on Pulse. Join me:"), url);
      if (r === 'downloaded') toast.success(t("Image saved. Post it to your story!"));
      track(user.uid, 'shares');
    } catch { toast.error(t("Couldn't make your recap. Try again.")); } finally { setBusy(false); }
  };
  return (
    <button onClick={make} disabled={busy} data-testid="recap-button"
      className="w-full h-12 rounded-2xl border border-violet-500/30 bg-violet-500/10 text-violet-200 font-bold text-sm flex items-center justify-center gap-2 hover:bg-violet-500/20 disabled:opacity-50">
      <ImageIcon className="w-4 h-4" /> {t("My week on Pulse")}
    </button>
  );
}

/** Question ideas for the create screen: one tap fills the form. */
export const QUESTION_STARTERS: Array<{ q: string; a: string; b: string }> = [
  { q: 'Would you move abroad for double the salary?', a: 'Yes', b: 'No' },
  { q: 'Friday plans: stay in or go out?', a: 'Stay in', b: 'Go out' },
  { q: 'Is it OK to check your partner\'s phone?', a: 'Yes', b: 'Never' },
  { q: 'Koshary or shawarma at 2am?', a: 'Koshary', b: 'Shawarma' },
  { q: 'Have you ever lied about being on your way?', a: 'Of course', b: 'Never' },
  { q: 'Work from home or office?', a: 'Home', b: 'Office' },
];

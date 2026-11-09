import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { Swords, Trophy, Share2, X, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../lib/firebase';
import { t, lang } from '../lib/i18n';
import { useAuth } from './AuthProvider';
import { awardBracketCredit } from '../lib/credits';
import { track } from '../lib/activity';
import { pickCard, sharePick } from '../lib/share';
import { inviteUrl } from '../lib/member';
import {
  MATCHES, matchOf, roundOf, pickShare, communityChampion, submitBracket,
  type Bracket, type Tally,
} from '../lib/knockout';

const nameOf = (b: Bracket, i: number) => (lang === 'ar' && b.contenders[i]?.name_ar) || b.contenders[i]?.name || '';
const titleOf = (b: Bracket) => (lang === 'ar' && b.title_ar) || b.title;

/** Feed banner: the newest live bracket, and any others still open. */
export function KnockoutBanner() {
  const { user } = useAuth();
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [open, setOpen] = useState<Bracket | null>(null);
  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, 'brackets'), where('status', '==', 'live')))
      .then((s) => setBrackets(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Bracket)
        .filter((b) => b.contenders?.length === 8)
        .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))))
      .catch(() => {});
  }, [user?.uid]);
  if (!brackets.length) return null;
  const [latest, ...more] = brackets;
  return (
    <div className="space-y-2" data-testid="knockout-banner">
      <button onClick={() => setOpen(latest)}
        className="w-full text-left rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-center gap-3 hover:bg-rose-500/15">
        <Swords className="w-5 h-5 text-rose-400 shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-rose-300">{t("Knockout")}</p>
          <p className="font-bold truncate">{titleOf(latest)}</p>
        </div>
        <span className="ml-auto text-xs text-rose-300 shrink-0">{t("Play")}</span>
      </button>
      {more.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {more.map((b) => (
            <button key={b.id} onClick={() => setOpen(b)}
              className="shrink-0 rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:text-white">
              <Swords className="inline w-3 h-3 mr-1" />{titleOf(b)}
            </button>
          ))}
        </div>
      )}
      <AnimatePresence>{open && <KnockoutPlay bracket={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

function KnockoutPlay({ bracket, onClose }: { bracket: Bracket; onClose: () => void }) {
  const { user } = useAuth();
  const [picks, setPicks] = useState<number[]>([]);
  const [done, setDone] = useState<number[] | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);

  // Already played? Show the results instead of a second run.
  useEffect(() => {
    if (!user) return;
    Promise.all([
      getDoc(doc(db, 'bracketPicks', `${user.uid}_${bracket.id}`)),
      getDoc(doc(db, 'bracketResults', bracket.id)),
    ]).then(([p, r]) => {
      if (r.exists()) setTally(r.data() as Tally);
      if (p.exists()) setDone(p.data().picks as number[]);
    }).catch(() => {}).finally(() => setChecking(false));
  }, [bracket.id, user?.uid]);

  const choose = async (w: number) => {
    if (!user || saving) return;
    const next = [...picks, w];
    setPicks(next);
    if (next.length < MATCHES) return;
    setSaving(true);
    try {
      const after = await submitBracket(db, user.uid, bracket.id, next);
      setTally(after);
      setDone(next);
      await awardBracketCredit(db, user.uid);
      toast.success(t("Bracket complete! +1 Credit"));
      toast(t("Your picks are anonymous"));
      track(user.uid, 'answers');
    } catch (e) {
      console.error('Bracket save failed', e);
      toast.error(t("Couldn't save your bracket. Try again."));
      setPicks(next.slice(0, -1));
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/95 overflow-y-auto p-4" data-testid="knockout-overlay">
      <div className="max-w-md mx-auto space-y-6 py-6">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-rose-300 flex items-center gap-1.5"><Swords className="w-4 h-4" /> {t("Knockout")}</span>
          <button onClick={onClose} aria-label={t("Close")} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{titleOf(bracket)}</h2>
        {checking ? (
          <div className="py-16 flex justify-center"><div className="w-8 h-8 border-4 border-white/10 border-t-white rounded-full animate-spin" /></div>
        ) : done ? (
          <KnockoutResults bracket={bracket} picks={done} tally={tally} />
        ) : (
          <Match bracket={bracket} picks={picks} onPick={choose} saving={saving} />
        )}
      </div>
    </motion.div>
  );
}

function Match({ bracket, picks, onPick, saving }: { bracket: Bracket; picks: number[]; onPick: (w: number) => void; saving: boolean }) {
  const i = picks.length;
  const [a, b] = matchOf(i, picks);
  const label = i < 4 ? `${t("Quarter-final")} ${i + 1}/4` : i < 6 ? `${t("Semi-final")} ${i - 3}/2` : t("Final");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="font-bold uppercase tracking-widest" data-testid="knockout-round">{label}</span>
        <span>{i + 1}/{MATCHES}</span>
      </div>
      <div className="h-1 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-rose-400 transition-all" style={{ width: `${(i / MATCHES) * 100}%` }} /></div>
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-3">
          {[a, b].map((c, k) => (
            <React.Fragment key={c}>
              {k === 1 && <p className="text-center text-xs font-bold text-zinc-600">{t("VS")}</p>}
              <button disabled={saving} onClick={() => onPick(c)} data-testid="knockout-option"
                className="w-full min-h-24 rounded-3xl border border-zinc-800 bg-zinc-900/60 px-6 py-6 text-xl font-bold hover:border-white/40 active:scale-[0.98] transition-all disabled:opacity-50">
                {nameOf(bracket, c)}
              </button>
            </React.Fragment>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function KnockoutResults({ bracket, picks, tally }: { bracket: Bracket; picks: number[]; tally: Tally | null }) {
  const { user } = useAuth();
  const mine = picks[6];
  const pulse = communityChampion(tally);
  const agree = tally && pulse ? Math.round(((tally.champ[mine] ?? 0) / pulse.total) * 100) : null;
  const [idea, setIdea] = useState('');
  const [sent, setSent] = useState(false);

  const share = async () => {
    if (!user) return;
    const url = user.memberNumber && user.referralCode ? inviteUrl(user.referralCode) : window.location.origin;
    const blob = await pickCard(titleOf(bracket), `🏆 ${nameOf(bracket, mine)}`, agree ?? 100, url);
    const r = await sharePick(blob, `${titleOf(bracket)}: ${t("my champion is")} ${nameOf(bracket, mine)}. ${t("Who's yours?")}`, url);
    if (r === 'downloaded') toast.success(t("Image saved. Post it to your story!"));
    track(user.uid, 'shares');
  };
  const suggest = async () => {
    const text = idea.trim();
    if (text.length < 2) return;
    try {
      await addDoc(collection(db, 'bracketSuggestions'), { text: text.slice(0, 60), lang, createdAt: serverTimestamp() });
      setSent(true); setIdea('');
      toast.success(t("Thanks! The best ideas become future brackets."));
    } catch { toast.error(t("Couldn't send that. Try again.")); }
  };

  return (
    <div className="space-y-6" data-testid="knockout-results">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-rose-300">{t("Your champion")}</p>
          <p className="text-lg font-bold flex items-center gap-1.5" data-testid="my-champion"><Trophy className="w-4 h-4 text-yellow-400 shrink-0" />{nameOf(bracket, mine)}</p>
          {agree !== null && <p className="text-xs text-zinc-400">{agree}% {t("crowned them too")}</p>}
        </div>
        <div className="rounded-3xl border border-white/10 bg-zinc-900/60 p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t("Pulse's champion")}</p>
          <p className="text-lg font-bold" data-testid="pulse-champion">{pulse ? nameOf(bracket, pulse.idx) : '…'}</p>
          {pulse && <p className="text-xs text-zinc-400">{pulse.pct}% · {pulse.total} {t("brackets")}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("Your picks, and how everyone voted")}</p>
        {Array.from({ length: MATCHES }, (_, i) => {
          const [a, b] = matchOf(i, picks);
          const w = picks[i];
          const pct = pickShare(tally, a, b, w);
          return (
            <div key={i} className="rounded-2xl border border-zinc-800 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-600">
                <span>{t(roundOf(i))}</span><span>{nameOf(bracket, w === a ? b : a)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold">{nameOf(bracket, w)}</span>
                <span className="text-zinc-400">{pct === null ? '' : `${pct}%`}</span>
              </div>
              {pct !== null && <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} className="h-full bg-white" /></div>}
            </div>
          );
        })}
      </div>

      <button onClick={share} className="w-full h-12 rounded-2xl bg-white text-black font-bold flex items-center justify-center gap-2">
        <Share2 className="w-4 h-4" /> {t("Share my champion")}
      </button>

      <div className="rounded-3xl border border-zinc-800 p-4 space-y-3" data-testid="knockout-suggest">
        <p className="text-sm font-bold flex items-center gap-2"><Lightbulb className="w-4 h-4 text-yellow-400" /> {t("Suggest a contender or a topic for the next bracket")}</p>
        {sent ? <p className="text-xs text-zinc-400">{t("Sent. Thank you!")}</p> : (
          <div className="flex gap-2">
            <input value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={60} placeholder={t("e.g. Best shawarma in Abu Dhabi")}
              className="flex-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-white/20" />
            <button onClick={suggest} disabled={idea.trim().length < 2} className="px-4 rounded-xl bg-zinc-800 text-sm font-bold disabled:opacity-40">{t("Send")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { collection, doc, getCountFromServer, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from './firebase';
import { t } from './i18n';
import { ASK_PROMPT_ANSWERS, ENTRY_ANSWERS, UNLOCK_ANSWERS, claimMemberNumber, formatMemberNumber } from './member';
import type { UserProfile } from '../types';

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/** How many questions this user has answered: counted once, then +1 per vote. */
export function useAnswerCount(uid: string | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (!uid) return;
    let cancelled = false;
    getCountFromServer(query(collection(db, 'user_answers'), where('userId', '==', uid)))
      .then((s) => !cancelled && setCount(s.data().count))
      .catch(() => !cancelled && setCount(ENTRY_ANSWERS)); // never lock anyone out on a read error
    const bump = () => setCount((c) => (c === null ? c : c + 1));
    window.addEventListener('pulse:answered', bump);
    return () => { cancelled = true; window.removeEventListener('pulse:answered', bump); };
  }, [uid]);
  return count;
}

/**
 * The member's path: in at ENTRY_ANSWERS, member number and invite link at
 * UNLOCK_ANSWERS, a weekly nudge to ask a question from ASK_PROMPT_ANSWERS.
 */
export function useMemberProgress(user: UserProfile | null, answers: number | null, onAsk: () => void) {
  const prev = useRef<number | null>(null);
  const claiming = useRef(false);

  useEffect(() => {
    if (!user || answers === null) return;
    const before = prev.current;
    prev.current = answers;

    if (before !== null && before < ENTRY_ANSWERS && answers >= ENTRY_ANSWERS) {
      toast.success(t("You're in! Groups, Games and asking questions are unlocked."));
    }

    if (answers >= UNLOCK_ANSWERS && !user.memberNumber && !claiming.current) {
      claiming.current = true;
      claimMemberNumber(db, user.uid)
        .then((n) => n && toast.success(`${t("You're member")} ${formatMemberNumber(n)}. ${t("Your invite link is unlocked in Profile.")}`, { duration: 6000 }))
        .catch((e) => { console.error('Member number claim failed; the nightly job will assign it:', e); });
    }

    // Only on a fresh answer, at most weekly.
    if (before !== null && answers > before && answers >= ASK_PROMPT_ANSWERS) {
      const last = store.get<number>('pulse.askPrompt', 0);
      if (Date.now() - last > 7 * 864e5) {
        store.set('pulse.askPrompt', Date.now());
        toast(t("What would you ask everyone?"), {
          description: t("Post a question. It's free, and you'll see how everyone answers."),
          action: { label: t("Ask"), onClick: onAsk },
          duration: 10000,
        });
      }
    }
  }, [user?.uid, user?.memberNumber, answers]);
}

const MILESTONES = [50, 100, 500];

/**
 * Tell an author how their questions are doing: answer milestones, the +5
 * credit at 100 answers (once the nightly job has paid it), and being picked
 * as Question of the Week. Private to the author; at most two notices per open.
 */
export function useAuthorMilestones(uid: string | undefined) {
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const seen = store.get<Record<string, number | boolean>>('pulse.milestones', {});
      const notes: Array<() => void> = [];
      const qs = await getDocs(query(collection(db, 'questions'), where('authorUid', '==', uid), limit(30)));
      for (const q of qs.docs) {
        const data = q.data();
        if (data.status !== 'live' && data.status !== 'retired') continue;
        const r = await getDoc(doc(db, 'results', q.id)).catch(() => null);
        const c = r?.data()?.counts ?? {};
        const total = (c['0'] ?? 0) + (c['1'] ?? 0);
        const hit = MILESTONES.filter((m) => total >= m).pop();
        if (hit && ((seen[q.id] as number) ?? 0) < hit) {
          seen[q.id] = hit;
          notes.push(() => toast.success(`${t("Your question hit")} ${hit} ${t("answers")} 🎉`, { description: data.text }));
        }
        if (data.rewarded100At && !seen[`r:${q.id}`]) {
          seen[`r:${q.id}`] = true;
          notes.push(() => toast.success(t("+5 credits: your question reached 100 answers"), { description: data.text }));
        }
        if (data.questionOfWeek && !seen[`w:${q.id}`]) {
          seen[`w:${q.id}`] = true;
          notes.push(() => toast.success(t("Your question is this week's Question of the Week!"), { description: t("Your identity stays hidden.") }));
        }
      }
      store.set('pulse.milestones', seen);
      notes.slice(0, 2).forEach((n, i) => setTimeout(n, 2500 + i * 1500));
    })().catch(() => {});
  }, [uid]);
}

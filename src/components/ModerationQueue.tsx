import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Question } from '../types';

/**
 * Admin review of questions held at `pending`.
 *
 * Moderation fails closed: any error from the moderator stores the question as
 * `pending`, which never reaches the feed. Nothing reviewed that state, so a
 * misconfigured Gemini key meant every new question accumulated invisibly and
 * the only symptom was a feed that stopped growing.
 *
 * Admin-ness is not asserted client-side. The component subscribes and, if the
 * rules refuse the read, renders nothing at all. That way it works for both
 * the hardcoded admin UID and anyone added to the admins roster, without the
 * client needing to read that roster -- which is sealed.
 */
export function ModerationQueue() {
  const [pending, setPending] = useState<Question[]>([]);
  const [permitted, setPermitted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'questions'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(50),
    );

    return onSnapshot(
      q,
      (snap) => {
        setPermitted(true);
        setPending(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Question)));
      },
      () => {
        // Not an admin, or the rules changed. Stay invisible rather than
        // showing an empty queue that looks like "nothing to review".
        setPermitted(false);
      },
    );
  }, []);

  const decide = async (q: Question, status: 'live' | 'rejected') => {
    if (busyId) return;
    setBusyId(q.id);
    try {
      await updateDoc(doc(db, 'questions', q.id), {
        status,
        ...(status === 'rejected' ? { rejectionReason: 'Rejected in review' } : {}),
      });
      toast.success(status === 'live' ? 'Question approved' : 'Question rejected');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `questions/${q.id}`);
    } finally {
      setBusyId(null);
    }
  };

  if (!permitted) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 ml-1 flex items-center gap-2">
        <ShieldCheck className="w-3 h-3" /> Moderation Queue
        {pending.length > 0 && (
          <span className="bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full text-[10px]">
            {pending.length}
          </span>
        )}
      </h3>

      {pending.length === 0 ? (
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 text-center">
          <p className="text-sm text-zinc-500">Nothing held for review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {pending.map((q) => (
              <motion.div
                key={q.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="bg-zinc-900/50 border border-white/5 rounded-3xl p-5 space-y-4"
              >
                <div className="space-y-2">
                  <p className="font-bold leading-tight">{q.text}</p>
                  <div className="flex gap-2 text-[10px] uppercase tracking-widest font-bold text-zinc-600">
                    <span>{q.options?.[0]}</span>
                    <span className="text-zinc-800">/</span>
                    <span>{q.options?.[1]}</span>
                  </div>
                  {q.rejectionReason && (
                    <p className="text-[11px] text-amber-500/80">{q.rejectionReason}</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => decide(q, 'live')}
                    disabled={busyId === q.id}
                    className="flex-1 bg-white text-black rounded-2xl py-2.5 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" /> Approve
                  </button>
                  <button
                    onClick={() => decide(q, 'rejected')}
                    disabled={busyId === q.id}
                    className="flex-1 border border-zinc-700 text-zinc-300 rounded-2xl py-2.5 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                  >
                    <X className="w-4 h-4" /> Reject
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Gamepad2, Timer, Clock, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../AuthProvider';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  addDoc,
  serverTimestamp,
  orderBy,
  limit,
  arrayUnion
} from 'firebase/firestore';
import { Game, GameQuestion } from '../../types';
import { toast } from 'sonner';

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className, 
  disabled,
  loading
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'; 
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}) => {
  const variants = {
    primary: 'bg-white text-black hover:bg-white/90',
    secondary: 'bg-zinc-800 text-white hover:bg-zinc-700',
    outline: 'border border-zinc-700 text-white hover:bg-zinc-800',
    ghost: 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
  };

  return (
    <button 
      onClick={onClick}
      disabled={disabled || loading}
      className={`px-4 py-3 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {loading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : children}
    </button>
  );
};

export function GamePlay({ game, questionId }: { game: Game, questionId: string }) {
  const { user } = useAuth();
  const [question, setQuestion] = useState<GameQuestion | null>(null);
  const [step, setStep] = useState<'answer' | 'predict'>('answer');
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchQuestion = async () => {
      try {
        const qDoc = await getDoc(doc(db, 'game_questions', questionId));
        if (qDoc.exists()) {
          setQuestion({ id: qDoc.id, ...qDoc.data() } as GameQuestion);
        }
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `game_questions/${questionId}`);
      }
    };

    fetchQuestion();
  }, [questionId]);

  useEffect(() => {
    if (game.type !== 'live' || loading || !question) return;

    setTimeLeft(step === 'answer' ? 30 : 15);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step, loading, question, game.type]);

  const handleTimeout = () => {
    if (step === 'answer') {
      // Skip answer
      submitAnswer(-1);
    } else {
      // Skip prediction
      submitPrediction(-1);
    }
  };

  const submitAnswer = async (optionIndex: number) => {
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'games', game.id), {
        [`answers.${user.uid}.${questionId}`]: optionIndex,
        lastUpdated: new Date().toISOString()
      });
      setStep('predict');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'games');
    } finally {
      setSubmitting(false);
    }
  };

  const submitPrediction = async (optionIndex: number) => {
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'games', game.id), {
        [`predictions.${user.uid}.${questionId}`]: optionIndex,
        lastUpdated: new Date().toISOString()
      });
      // Component will unmount and GameView will show next state
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'games');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !question) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/10 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-500">
          <Gamepad2 className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">Question {game.questions.indexOf(questionId) + 1} / {game.questions.length}</span>
        </div>
        {game.type === 'live' ? (
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${timeLeft < 5 ? 'border-red-500/50 text-red-500 animate-pulse' : 'border-white/10 text-zinc-400'}`}>
            <Timer className="w-4 h-4" />
            <span className="text-sm font-bold tabular-nums">{timeLeft}s</span>
          </div>
        ) : (
          game.deadline && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 text-zinc-400">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-bold tabular-nums">
                {Math.max(0, Math.floor((new Date(game.deadline).getTime() - Date.now()) / (1000 * 60 * 60)))}h remaining
              </span>
            </div>
          )
        )}
      </div>

      <AnimatePresence mode="wait">
        {step === 'answer' ? (
          <motion.div
            key="answer"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="space-y-4">
              <h2 className="text-3xl font-bold tracking-tighter leading-tight">{question.text}</h2>
              <p className="text-zinc-500 uppercase tracking-widest text-[10px] font-bold">Step 1: Answer Honestly</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {question.options.map((opt, i) => (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => submitAnswer(i)}
                  className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl text-left hover:border-white/20 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold">{opt}</span>
                    <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center group-hover:border-white/30 transition-all">
                      <div className="w-2 h-2 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-all" />
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="predict"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="space-y-4">
              <h2 className="text-3xl font-bold tracking-tighter leading-tight">Who do you think the MAJORITY of the group will pick?</h2>
              <p className="text-zinc-500 uppercase tracking-widest text-[10px] font-bold">Step 2: Predict the Group</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {question.options.map((opt, i) => (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => submitPrediction(i)}
                  className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl text-left hover:border-white/20 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="text-xl font-bold">{opt}</span>
                      <p className="text-xs text-zinc-500">Predict Option {i === 0 ? 'A' : 'B'}</p>
                    </div>
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center group-hover:bg-white/10 transition-all">
                      <ArrowRight className="w-5 h-5 text-zinc-500 group-hover:text-white transition-all" />
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-zinc-900/20 border border-white/5 p-4 rounded-2xl flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-zinc-600" />
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Individual answers are never revealed. Only percentage splits are shown.</p>
      </div>
    </div>
  );
}

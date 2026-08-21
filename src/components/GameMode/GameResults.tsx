import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowRight, User, Timer, Clock, CheckCircle2, XCircle } from 'lucide-react';
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
  arrayUnion,
  increment
} from 'firebase/firestore';
import { advanceQuestion } from '../../lib/gameState';
import { Game, GameQuestion, UserProfile } from '../../types';
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

export function GameResults({ game, questionId }: { game: Game, questionId: string }) {
  const { user } = useAuth();
  const [question, setQuestion] = useState<GameQuestion | null>(null);
  const [players, setPlayers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [movingNext, setMovingNext] = useState(false);

  const isHost = game.hostUid === user?.uid;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const qDoc = await getDoc(doc(db, 'game_questions', questionId));
        if (qDoc.exists()) {
          setQuestion({ id: qDoc.id, ...qDoc.data() } as GameQuestion);
        }

        const playerDocs = await Promise.all(
          game.players.map(uid => getDoc(doc(db, 'users', uid)))
        );
        const playerMap: Record<string, string> = {};
        playerDocs.forEach(d => {
          if (d.exists()) playerMap[d.id] = (d.data() as UserProfile).username;
        });
        setPlayers(playerMap);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `game_questions/${questionId}`);
      } finally {
        // In a finally: a failed read must not leave the screen spinning.
        setLoading(false);
      }
    };

    fetchData();
  }, [questionId, game.players]);

  const nextQuestion = async () => {
    if (!isHost || movingNext) return;
    setMovingNext(true);
    try {
      const isLast = game.currentQuestionIndex === game.questions.length - 1;

      // Scoring and the status change happen in one transaction, keyed on the
      // question id, so a retry or a double click cannot score it twice.
      await advanceQuestion(db, game.id, questionId, user!.uid);

      toast.success(isLast ? 'Game finished!' : 'Next question!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'games');
    } finally {
      setMovingNext(false);
    }
  };

  if (loading || !question) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/10 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // Calculate results
  const answers = game.answers || {};
  const predictions = game.predictions || {};
  const counts = [0, 0];
  game.players.forEach(pUid => {
    const ans = answers[pUid]?.[questionId];
    if (ans === 0 || ans === 1) counts[ans]++;
  });

  const total = counts[0] + counts[1];
  const p1 = total > 0 ? Math.round((counts[0] / total) * 100) : 0;
  const p2 = total > 0 ? 100 - p1 : 0;
  const is5050 = p1 === 50 && p2 === 50;
  const majority = p1 > p2 ? 0 : p2 > p1 ? 1 : null;

  const myPrediction = predictions[user!.uid]?.[questionId];
  const isCorrect = majority !== null && myPrediction === majority;

  // Leaderboard data
  const leaderboard = game.players
    .map(uid => ({ uid, username: players[uid], score: game.scores[uid] || 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-8 pb-10">
      <div className="text-center space-y-4">
        <div className="flex flex-col items-center gap-2">
          {/* Authorship is deliberately absent here. CLAUDE.md: the author is
              revealed only on the final results screen. */}
          {game.type === 'async' && game.deadline && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
              <Clock className="w-3 h-3" /> {Math.max(0, Math.floor((new Date(game.deadline).getTime() - Date.now()) / (1000 * 60 * 60)))}h remaining
            </div>
          )}
        </div>
        <h2 className="text-3xl font-bold tracking-tighter leading-tight">{question.text}</h2>
      </div>

      <div className="space-y-4">
        {question.options.map((opt, i) => (
          <div key={i} className="relative h-20 bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${i === 0 ? p1 : p2}%` }}
              className={`absolute inset-y-0 left-0 ${i === majority ? 'bg-white/10' : 'bg-white/5'}`}
            />
            <div className="relative z-10 px-6 flex items-center justify-between h-full">
              <div className="flex items-center gap-3">
                <span className={`font-bold text-xl ${i === majority ? 'text-white' : 'text-zinc-500'}`}>{opt}</span>
                {i === majority && <Trophy className="w-4 h-4 text-yellow-500" />}
              </div>
              <span className="text-2xl font-bold tabular-nums">{i === 0 ? p1 : p2}%</span>
            </div>
          </div>
        ))}
      </div>

      {is5050 ? (
        <div className="bg-blue-500/10 border border-blue-500/20 p-6 rounded-3xl text-center space-y-2">
          <h3 className="text-2xl font-bold text-blue-400">Perfectly Divided 🎯</h3>
          <p className="text-blue-500/70 text-sm">The group is split exactly 50/50! No points awarded for this question.</p>
        </div>
      ) : (
        <div className={`p-6 rounded-3xl text-center space-y-2 border ${isCorrect ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
          <div className="flex items-center justify-center gap-3">
            {isCorrect ? <CheckCircle2 className="w-6 h-6 text-green-500" /> : <XCircle className="w-6 h-6 text-red-500" />}
            <h3 className={`text-2xl font-bold ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
              {isCorrect ? 'Correct Prediction!' : 'Wrong Prediction'}
            </h3>
          </div>
          <p className={`${isCorrect ? 'text-green-500/70' : 'text-red-500/70'} text-sm`}>
            {isCorrect ? 'You read the room perfectly. +1 Point' : 'The group went the other way. 0 Points'}
          </p>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500">Leaderboard</h3>
        <div className="space-y-2">
          {leaderboard.map((p, i) => (
            <div key={p.uid} className={`flex items-center justify-between p-4 rounded-2xl border ${p.uid === user?.uid ? 'bg-white/5 border-white/10' : 'bg-zinc-900/30 border-white/5'}`}>
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-zinc-600 w-4">{i + 1}</span>
                <span className={`font-bold ${p.uid === user?.uid ? 'text-white' : 'text-zinc-400'}`}>{p.username}</span>
              </div>
              <span className="font-bold tabular-nums">{p.score} pts</span>
            </div>
          ))}
        </div>
      </div>

      {isHost && (
        <Button 
          onClick={nextQuestion} 
          loading={movingNext}
          className="w-full h-14 text-lg"
        >
          {game.currentQuestionIndex === game.questions.length - 1 ? 'Finish Game' : 'Next Question'} <ArrowRight className="w-5 h-5" />
        </Button>
      )}

      {!isHost && (
        <div className="text-center py-4">
          <p className="text-zinc-500 animate-pulse">Waiting for host to continue...</p>
        </div>
      )}
    </div>
  );
}

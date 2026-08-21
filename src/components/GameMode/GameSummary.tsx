import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowRight, User, Timer, Clock, CheckCircle2, XCircle, LayoutGrid, RotateCcw } from 'lucide-react';
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

export function GameSummary({ game }: { game: Game }) {
  const { user } = useAuth();
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [players, setPlayers] = useState<Record<string, string>>({});
  // questionId -> author username. Only readable now the game is finished.
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const qDocs = await Promise.all(
          game.questions.map(id => getDoc(doc(db, 'game_questions', id)))
        );
        setQuestions(qDocs.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() } as GameQuestion)));

        const playerDocs = await Promise.all(
          game.players.map(uid => getDoc(doc(db, 'users', uid)))
        );
        const playerMap: Record<string, string> = {};
        playerDocs.forEach(d => {
          if (d.exists()) playerMap[d.id] = (d.data() as UserProfile).username;
        });
        setPlayers(playerMap);

        // Attribution is a separate collection, readable only once the game is
        // finished -- which is exactly this screen.
        const authorDocs = await Promise.all(
          game.questions.map(id => getDoc(doc(db, 'game_question_authors', id)))
        );
        const authorMap: Record<string, string> = {};
        authorDocs.forEach(d => {
          if (d.exists()) authorMap[d.id] = d.data().authorUsername as string;
        });
        setAuthors(authorMap);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'game_questions');
      } finally {
        // In a finally: a failed read must not leave the screen spinning.
        setLoading(false);
      }
    };

    fetchData();
  }, [game.questions, game.players]);

  const playAgain = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      const gameData = {
        type: game.type,
        status: 'lobby',
        hostUid: user!.uid,
        players: game.players,
        questions: [],
        currentQuestionIndex: 0,
        inviteCode: code,
        questionsPerPlayer: game.questionsPerPlayer,
        createdAt: new Date().toISOString(),
        scores: game.players.reduce((acc, uid) => ({ ...acc, [uid]: 0 }), {}),
        predictions: {},
        answers: {},
        playerQuestions: {}
      };

      await addDoc(collection(db, 'games'), gameData);
      toast.success('New game created with same players!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'games');
    } finally {
      setRestarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/10 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  const leaderboard = game.players
    .map(uid => ({ uid, username: players[uid], score: game.scores[uid] || 0 }))
    .sort((a, b) => b.score - a.score);

  const maxScore = Math.max(...leaderboard.map(p => p.score));
  const winners = leaderboard.filter(p => p.score === maxScore);

  const perfectlyDivided = questions.filter(q => {
    const counts = [0, 0];
    game.players.forEach(pUid => {
      const ans = game.answers?.[pUid]?.[q.id];
      if (ans === 0 || ans === 1) counts[ans]++;
    });
    const total = counts[0] + counts[1];
    return total > 0 && Math.round((counts[0] / total) * 100) === 50;
  });

  return (
    <div className="space-y-8 pb-10">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 bg-yellow-500/20 text-yellow-500 rounded-full flex items-center justify-center mx-auto">
          <Trophy className="w-10 h-10" />
        </div>
        <h2 className="text-4xl font-bold tracking-tighter">Game Over</h2>
        <p className="text-zinc-500">Here's how everyone read the room.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl space-y-4">
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500">🏆 Best Mind Reader</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {winners.map(w => (
              <div key={w.uid} className="bg-white text-black px-4 py-2 rounded-xl font-bold flex items-center gap-2">
                {w.username} <span className="opacity-50">{w.score} pts</span>
              </div>
            ))}
          </div>
        </div>

        {perfectlyDivided.length > 0 && (
          <div className="bg-blue-500/10 border border-blue-500/20 p-6 rounded-3xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">🎯</span>
              <h3 className="font-bold uppercase tracking-widest text-xs text-blue-400">Perfectly Divided Questions</h3>
            </div>
            <div className="space-y-2">
              {perfectlyDivided.map(q => (
                <div key={q.id} className="text-sm text-blue-500/70 font-medium">
                  "{q.text}"
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500">Final Leaderboard</h3>
        <div className="space-y-2">
          {leaderboard.map((p, i) => (
            <motion.div 
              key={p.uid}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`flex items-center justify-between p-4 rounded-2xl border ${p.uid === user?.uid ? 'bg-white/5 border-white/10' : 'bg-zinc-900/30 border-white/5'}`}
            >
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-zinc-600 w-4">{i + 1}</span>
                <span className={`font-bold ${p.uid === user?.uid ? 'text-white' : 'text-zinc-400'}`}>{p.username}</span>
              </div>
              <span className="font-bold tabular-nums">{p.score} pts</span>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500">Question Summary</h3>
        <div className="space-y-4">
          {questions.map(q => {
            const counts = [0, 0];
            game.players.forEach(pUid => {
              const ans = game.answers?.[pUid]?.[q.id];
              if (ans === 0 || ans === 1) counts[ans]++;
            });
            const total = counts[0] + counts[1];
            const p1 = total > 0 ? Math.round((counts[0] / total) * 100) : 0;
            const p2 = total > 0 ? 100 - p1 : 0;

            return (
              <div key={q.id} className="bg-zinc-900/30 border border-white/5 p-6 rounded-3xl space-y-4">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                  <span>By {authors[q.id] ?? 'a player'}</span>
                  <span>{total} Votes</span>
                </div>
                <h4 className="font-bold text-lg leading-tight">{q.text}</h4>
                <div className="flex gap-2">
                  <div className="flex-1 bg-zinc-800/50 p-3 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">{q.options[0]}</span>
                    <span className="font-bold text-sm">{p1}%</span>
                  </div>
                  <div className="flex-1 bg-zinc-800/50 p-3 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">{q.options[1]}</span>
                    <span className="font-bold text-sm">{p2}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Button 
        onClick={playAgain} 
        loading={restarting}
        className="w-full h-14 text-lg"
      >
        <RotateCcw className="w-5 h-5" /> Play Again
      </Button>
    </div>
  );
}

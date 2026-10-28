import { t } from '../../lib/i18n';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Copy, Play, ArrowLeft, Clock, Timer, Trash2 } from 'lucide-react';
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
  deleteDoc
} from 'firebase/firestore';
import { startGame as startGameTransition } from '../../lib/gameState';
import { Game, UserProfile } from '../../types';
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

export function GameLobby({ game }: { game: Game }) {
  const { user } = useAuth();
  const [players, setPlayers] = useState<{ uid: string, username: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [deadlineHours, setDeadlineHours] = useState(24);
  const [questionsPerPlayer, setQuestionsPerPlayer] = useState(game.questionsPerPlayer || 2);

  const isHost = game.hostUid === user?.uid;

  useEffect(() => {
    // Fetch player usernames
    const fetchPlayers = async () => {
      try {
        const playerDocs = await Promise.all(
          game.players.map(uid => getDoc(doc(db, 'users', uid)))
        );
        const playerData = playerDocs
          .filter(d => d.exists())
          .map(d => ({ uid: d.id, username: (d.data() as UserProfile).username }));
        setPlayers(playerData);
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'users');
      }
    };

    fetchPlayers();
  }, [game.players]);

  const copyCode = () => {
    navigator.clipboard.writeText(game.inviteCode);
    toast.success(t("Code copied to clipboard!"));
  };

  const startGame = async () => {
    if (!isHost || players.length < 2 || starting) return;
    setStarting(true);
    try {
      const deadline = game.type === 'async' 
        ? new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString()
        : null;

      await startGameTransition(db, game.id, user!.uid, { deadline, questionsPerPlayer });
      toast.success(t("Game started! Time to submit questions."));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'games');
    } finally {
      setStarting(false);
    }
  };

  const leaveGame = async () => {
    if (starting) return;
    try {
      if (isHost) {
        // If host leaves, delete the game? Or just leave?
        // Prompt says host can share code. If host leaves, game is dead.
        await deleteDoc(doc(db, 'games', game.id));
        toast.info(t("Game cancelled by host."));
      } else {
        const newPlayers = game.players.filter(p => p !== user?.uid);
        await updateDoc(doc(db, 'games', game.id), {
          players: newPlayers
        });
        toast.info(t("Left the game."));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'games');
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between">
        <button onClick={leaveGame} className="text-zinc-500 hover:text-white transition-colors flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> {isHost ? t("Cancel Game") : t("Leave Lobby")}
        </button>
        <div className="flex items-center gap-2 text-zinc-500">
          {game.type === 'live' ? <Timer className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
          <span className="text-xs font-bold uppercase tracking-widest">{game.type} {t("Mode")}</span>
        </div>
      </div>

      <div className="text-center space-y-4">
        <h2 className="text-4xl font-bold tracking-tighter">{t("Waiting Lobby")}</h2>
        <div className="bg-zinc-900/50 border border-white/5 p-8 rounded-3xl space-y-4 inline-block mx-auto min-w-[200px]">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("Share this code")}</p>
          <div className="text-5xl font-mono font-bold tracking-[0.2em] text-white">{game.inviteCode}</div>
          <Button variant="secondary" onClick={copyCode} className="w-full">
            <Copy className="w-4 h-4" /> {t("Copy Code")}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-zinc-500" />
            <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500">{t("Players (")}{players.length})</h3>
          </div>
          {players.length < 2 && (
            <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest">{t("Min 2 players required")}</span>
          )}
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <AnimatePresence>
            {players.map((p, i) => (
              <motion.div
                key={p.uid}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl flex items-center gap-3"
              >
                <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center text-xs font-bold">
                  {p.username.charAt(0).toUpperCase()}
                </div>
                <span className="font-bold truncate">{p.username}</span>
                {p.uid === game.hostUid && <span className="text-[8px] bg-white/10 px-1.5 py-0.5 rounded text-zinc-400 uppercase">{t("Host")}</span>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {isHost && (
        <div className="space-y-6 bg-zinc-900/30 border border-white/5 p-6 rounded-3xl">
          <div className="space-y-4">
            <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("Questions per player")}</label>
            <div className="flex gap-2">
              {[2, 3, 4, 5, 10].map(n => (
                <button
                  key={n}
                  onClick={() => setQuestionsPerPlayer(n)}
                  className={`flex-1 py-2 rounded-xl font-bold transition-all ${questionsPerPlayer === n ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-500 hover:text-white'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {game.type === 'async' && (
            <div className="space-y-4">
              <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("Game Deadline")}</label>
              <div className="flex gap-2">
                {[24, 48, 72].map(h => (
                  <button
                    key={h}
                    onClick={() => setDeadlineHours(h)}
                    className={`flex-1 py-2 rounded-xl font-bold transition-all ${deadlineHours === h ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-500 hover:text-white'}`}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button 
            onClick={startGame} 
            loading={starting}
            disabled={players.length < 2}
            className="w-full h-14 text-lg"
          >
            <Play className="w-5 h-5 fill-current" /> {t("Start Game")}
          </Button>
        </div>
      )}

      {!isHost && (
        <div className="text-center py-4">
          <p className="text-zinc-500 animate-pulse">{t("Waiting for host to start...")}</p>
        </div>
      )}
    </div>
  );
}

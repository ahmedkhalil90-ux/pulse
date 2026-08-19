import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Gamepad2, Timer, Clock, ArrowRight, History, Plus, UserPlus } from 'lucide-react';
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
import { Game } from '../../types';
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

const Input = ({ 
  value, 
  onChange, 
  placeholder, 
  className,
  type = "text",
  maxLength
}: { 
  value: string; 
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; 
  placeholder?: string;
  className?: string;
  type?: string;
  maxLength?: number;
}) => (
  <input 
    type={type}
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    maxLength={maxLength}
    className={`w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/20 transition-colors ${className}`}
  />
);

export function GameHome({ onSelectGame }: { onSelectGame: (game: Game) => void }) {
  const { user } = useAuth();
  const [myGames, setMyGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'games'),
      where('players', 'array-contains', user.uid),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMyGames(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Game)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'games');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const createGame = async (type: 'live' | 'async') => {
    if (!user || creating) return;
    setCreating(true);
    try {
      const code = generateCode();
      const gameData = {
        type,
        status: 'lobby',
        hostUid: user.uid,
        players: [user.uid],
        questions: [],
        currentQuestionIndex: 0,
        inviteCode: code,
        questionsPerPlayer: 2, // Default
        createdAt: new Date().toISOString(),
        scores: { [user.uid]: 0 },
        predictions: {},
        answers: {},
        playerQuestions: {}
      };

      const docRef = await addDoc(collection(db, 'games'), gameData);
      onSelectGame({ id: docRef.id, ...gameData } as Game);
      toast.success(`${type === 'live' ? 'Live' : 'Async'} game created!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'games');
    } finally {
      setCreating(false);
    }
  };

  const joinGame = async () => {
    if (!user || !joinCode.trim() || joining) return;
    setJoining(true);
    try {
      const q = query(
        collection(db, 'games'),
        where('inviteCode', '==', joinCode.toUpperCase().trim()),
        where('status', '==', 'lobby'),
        limit(1)
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        toast.error('Game not found or already started.');
        return;
      }

      const gameDoc = snapshot.docs[0];
      const gameData = gameDoc.data() as Game;

      if (gameData.players.includes(user.uid)) {
        onSelectGame({ id: gameDoc.id, ...gameData } as Game);
        return;
      }

      await updateDoc(doc(db, 'games', gameDoc.id), {
        players: arrayUnion(user.uid),
        [`scores.${user.uid}`]: 0
      });

      onSelectGame({ id: gameDoc.id, ...gameData, players: [...gameData.players, user.uid] } as Game);
      toast.success('Joined the game!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'games');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tighter">Game Mode</h2>
        <p className="text-zinc-500">Challenge your squad and test your mind-reading skills.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => createGame('live')}
          className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl text-left space-y-4 hover:border-white/20 transition-all group"
        >
          <div className="w-12 h-12 bg-white text-black rounded-2xl flex items-center justify-center">
            <Timer className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold">Play Live</h3>
            <p className="text-zinc-500 text-sm">Everyone online together. Answer in real-time and see results instantly.</p>
          </div>
          <div className="flex items-center gap-2 text-white font-bold text-sm group-hover:gap-3 transition-all">
            Start Live Game <ArrowRight className="w-4 h-4" />
          </div>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => createGame('async')}
          className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl text-left space-y-4 hover:border-white/20 transition-all group"
        >
          <div className="w-12 h-12 bg-zinc-800 text-white rounded-2xl flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold">Play Async</h3>
            <p className="text-zinc-500 text-sm">Play at your own pace. Results revealed when everyone is done or time runs out.</p>
          </div>
          <div className="flex items-center gap-2 text-zinc-400 font-bold text-sm group-hover:text-white transition-all">
            Start Async Game <ArrowRight className="w-4 h-4" />
          </div>
        </motion.button>
      </div>

      <div className="bg-zinc-900/30 border border-white/5 p-6 rounded-3xl space-y-4">
        <div className="flex items-center gap-3">
          <UserPlus className="w-5 h-5 text-zinc-500" />
          <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500">Join a Game</h3>
        </div>
        <div className="flex gap-2">
          <Input 
            value={joinCode} 
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())} 
            placeholder="ENTER 6-CHAR CODE"
            maxLength={6}
            className="text-center font-mono tracking-widest text-xl"
          />
          <Button 
            onClick={joinGame} 
            loading={joining}
            disabled={joinCode.length < 6}
            className="px-8"
          >
            Join
          </Button>
        </div>
      </div>

      {myGames.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-zinc-500" />
            <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500">My Games</h3>
          </div>
          <div className="space-y-3">
            {myGames.map(game => (
              <button
                key={game.id}
                onClick={() => onSelectGame(game)}
                className="w-full bg-zinc-900/50 border border-white/5 p-4 rounded-2xl flex items-center justify-between hover:bg-zinc-800/50 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${game.type === 'live' ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400'}`}>
                    {game.type === 'live' ? <Timer className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                  </div>
                  <div className="text-left">
                    <div className="font-bold flex items-center gap-2">
                      {game.inviteCode}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${
                        game.status === 'active' ? 'bg-green-500/20 text-green-500' : 
                        game.status === 'finished' ? 'bg-zinc-800 text-zinc-500' : 'bg-blue-500/20 text-blue-500'
                      }`}>
                        {game.status}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500">
                      {game.players.length} Players • {new Date(game.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-700" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

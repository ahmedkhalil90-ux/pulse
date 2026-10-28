import { t } from '../../lib/i18n';
import React, { useState, useEffect } from 'react';
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
  limit
} from 'firebase/firestore';
import { Game, GameQuestion } from '../../types';
import { GameHome } from './GameHome';
import { GameLobby } from './GameLobby';
import { QuestionSubmission } from './QuestionSubmission';
import { GamePlay } from './GamePlay';
import { GameResults } from './GameResults';
import { GameSummary } from './GameSummary';
import { toast } from 'sonner';

export function GameView() {
  const { user } = useAuth();
  const [activeGame, setActiveGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    // Listen for any active or finished game the user is part of
    const q = query(
      collection(db, 'games'),
      where('players', 'array-contains', user.uid),
      where('status', 'in', ['lobby', 'active', 'finished']),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setActiveGame({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Game);
      } else {
        setActiveGame(null);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'games');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/10 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!activeGame) {
    return <GameHome onSelectGame={(game) => setActiveGame(game)} />;
  }

  // Determine which sub-view to show based on game status and user progress
  if (activeGame.status === 'lobby') {
    return <GameLobby game={activeGame} />;
  }

  if (activeGame.status === 'active') {
    // Check if user has submitted their questions
    const hasSubmittedQuestions = activeGame.playerQuestions?.[user!.uid]?.length === activeGame.questionsPerPlayer;
    
    if (!hasSubmittedQuestions) {
      return <QuestionSubmission game={activeGame} />;
    }

    // In live mode, everyone is on the same question
    // In async mode, players go at their own pace
    if (activeGame.type === 'live') {
      const currentQuestionId = activeGame.questions[activeGame.currentQuestionIndex];
      const hasAnswered = activeGame.answers?.[user!.uid]?.[currentQuestionId] !== undefined;
      const hasPredicted = activeGame.predictions?.[user!.uid]?.[currentQuestionId] !== undefined;

      // If everyone has finished the current question, show results
      const allFinished = activeGame.players.every(pUid => 
        activeGame.answers?.[pUid]?.[currentQuestionId] !== undefined && 
        activeGame.predictions?.[pUid]?.[currentQuestionId] !== undefined
      );

      if (allFinished) {
        return <GameResults game={activeGame} questionId={currentQuestionId} />;
      }

      return <GamePlay game={activeGame} questionId={currentQuestionId} />;
    } else {
      // Async mode
      // Find the first question the user hasn't finished
      const nextQuestionId = activeGame.questions.find(qId => 
        activeGame.answers?.[user!.uid]?.[qId] === undefined || 
        activeGame.predictions?.[user!.uid]?.[qId] === undefined
      );

      if (!nextQuestionId) {
        // User finished all questions, wait for others or deadline
        return (
          <div className="text-center py-20 space-y-4">
            <h2 className="text-2xl font-bold">{t("All caught up!")}</h2>
            <p className="text-zinc-500">{t("Waiting for other players or the deadline to reveal results.")}</p>
            {activeGame.deadline && (
              <p className="text-sm text-zinc-400">
                {t("Deadline:")} {new Date(activeGame.deadline).toLocaleString()}
              </p>
            )}
          </div>
        );
      }

      return <GamePlay game={activeGame} questionId={nextQuestionId} />;
    }
  }

  if (activeGame.status === 'finished') {
    return <GameSummary game={activeGame} />;
  }

  return null;
}

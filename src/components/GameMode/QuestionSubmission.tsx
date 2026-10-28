import { t } from '../../lib/i18n';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, ArrowRight, MessageSquare, Trash2 } from 'lucide-react';
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
  writeBatch
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

export function QuestionSubmission({ game }: { game: Game }) {
  const { user } = useAuth();
  const [questions, setQuestions] = useState<{ text: string, options: [string, string] }[]>([]);
  const [currentText, setCurrentText] = useState('');
  const [currentOptions, setCurrentOptions] = useState<[string, string]>(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const questionsNeeded = game.questionsPerPlayer;
  const questionsRemaining = questionsNeeded - questions.length;

  const addQuestion = () => {
    if (!currentText.trim() || !currentOptions[0].trim() || !currentOptions[1].trim()) {
      toast.error(t("Please fill in the question and both options."));
      return;
    }
    setQuestions([...questions, { text: currentText, options: [...currentOptions] as [string, string] }]);
    setCurrentText('');
    setCurrentOptions(['', '']);
  };

  const removeQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const submitAll = async () => {
    if (!user || questions.length < questionsNeeded || submitting) return;
    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      const questionIds: string[] = [];

      for (const q of questions) {
        const qRef = doc(collection(db, 'game_questions'));
        questionIds.push(qRef.id);
        batch.set(qRef, {
          gameId: game.id,
          text: q.text,
          options: q.options,
          createdAt: new Date().toISOString()
        });
        // Attribution lives apart and is unreadable until the game finishes,
        // so players cannot see who wrote a question while answering it.
        batch.set(doc(db, 'game_question_authors', qRef.id), {
          gameId: game.id,
          authorUid: user.uid,
          authorUsername: user.username
        });
      }

      const gameRef = doc(db, 'games', game.id);
      batch.update(gameRef, {
        questions: arrayUnion(...questionIds),
        [`playerQuestions.${user.uid}`]: questionIds,
        lastUpdated: new Date().toISOString()
      });

      await batch.commit();
      setSubmitted(true);
      toast.success(t("Questions submitted!"));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'game_questions');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-20 space-y-6">
        <div className="w-20 h-20 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto">
          <Check className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter">{t("Ready!")}</h2>
          <p className="text-zinc-500">{t("Waiting for other players to submit their questions.")}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl space-y-4 max-w-xs mx-auto">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">{t("Status")}</span>
            <span className="text-green-500 font-bold uppercase tracking-widest text-[10px]">{t("Submitted")}</span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              className="h-full bg-green-500"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tighter">{t("Submit Questions")}</h2>
        <p className="text-zinc-500">{t("Create")} {questionsNeeded} {t("questions for this game. Be creative!")}</p>
      </div>

      <div className="space-y-6">
        <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("Question (")}{currentText.length}/100)</label>
            <Input 
              value={currentText} 
              onChange={(e) => setCurrentText(e.target.value)} 
              placeholder={t("e.g. Is a hotdog a sandwich?")}
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("Option A (")}{currentOptions[0].length}/40)</label>
              <Input 
                value={currentOptions[0]} 
                onChange={(e) => setCurrentOptions([e.target.value, currentOptions[1]])} 
                placeholder={t("Yes")}
                maxLength={40}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t("Option B (")}{currentOptions[1].length}/40)</label>
              <Input 
                value={currentOptions[1]} 
                onChange={(e) => setCurrentOptions([currentOptions[0], e.target.value])} 
                placeholder={t("No")}
                maxLength={40}
              />
            </div>
          </div>

          <Button 
            onClick={addQuestion} 
            variant="secondary" 
            className="w-full"
            disabled={questionsRemaining === 0}
          >
            <Plus className="w-4 h-4" /> {t("Add Question")}
          </Button>
        </div>

        {questions.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500">{t("Your Questions (")}{questions.length}/{questionsNeeded})</h3>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div key={i} className="bg-zinc-900/30 border border-white/5 p-4 rounded-2xl flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-bold text-sm">{q.text}</p>
                    <p className="text-xs text-zinc-500">{q.options[0]} vs {q.options[1]}</p>
                  </div>
                  <button onClick={() => removeQuestion(i)} className="p-2 text-zinc-600 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button 
          onClick={submitAll} 
          loading={submitting}
          disabled={questions.length < questionsNeeded}
          className="w-full h-14 text-lg"
        >
          {t("Submit All Questions")} <ArrowRight className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}

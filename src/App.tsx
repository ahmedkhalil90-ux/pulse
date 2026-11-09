import { t, qText, qOptions, lang, setLang } from './lib/i18n';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Flame,
  Image as ImageIcon,
  MessageCircle,
  Share2,
  Users, 
  Gamepad2, 
  User, 
  LayoutGrid, 
  CheckCircle2, 
  Sparkles,
  Ticket,
  AlertCircle,
  TrendingUp,
  Globe,
  MapPin,
  Calendar,
  ArrowRight,
  ShieldCheck,
  Coins,
  X,
  Lock,
  ChevronLeft,
  ChevronRight,
  Trash2,
  LogOut,
  Copy,
  ExternalLink,
  UserPlus,
  Trophy,
  Timer,
  Clock,
  Play,
  Check,
  MessageSquare,
  History,
  RotateCcw,
  PartyPopper,
  Zap,
  Flag
} from 'lucide-react';
import { useAuth, AuthProvider } from './components/AuthProvider';
import { db, auth, handleFirestoreError, OperationType } from './lib/firebase';
import { 
  collection,
  collectionGroup, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  addDoc, 
  setDoc, 
  doc, 
  increment, 
  getDoc,
  updateDoc,
  serverTimestamp,
  getDocs,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  writeBatch
} from 'firebase/firestore';
import {
  InsufficientCreditsError,
  awardAnswerCredit,
  boostQuestion,
  unlockDemographics,
} from './lib/credits';
import { castVote } from './lib/votes';
import { orderFeed, categoryInterest } from './lib/feedOrder';
import { track } from './lib/activity';
import { ENTRY_ANSWERS, UNLOCK_ANSWERS, memberLabel, inviteUrl } from './lib/member';
import { useAnswerCount, useMemberProgress, useAuthorMilestones } from './lib/progress';
import { POST_CATEGORIES, ALL_CATEGORIES, categoriesByCount } from './lib/categories';
import { findSimilar, type IndexItem } from './lib/similar';
import { questionUrl, shareText, whatsappUrl, shareLink, pickCard, sharePick } from './lib/share';

// Live questions for the duplicate check, written nightly by the ranking job
// (ops/questionIndex). Loaded once per session.
let questionIndexCache: Promise<IndexItem[]> | null = null;
function loadQuestionIndex(): Promise<IndexItem[]> {
  questionIndexCache ??= getDoc(doc(db, 'ops', 'questionIndex'))
    .then((s) => (s.exists() ? (s.data().items as IndexItem[]) : []))
    .catch(() => []);
  return questionIndexCache;
}
import { ModerationQueue } from './components/ModerationQueue';
import { KnockoutBanner } from './components/Knockout';

// A fixed list, so demographic buckets do not fragment ("UAE" vs "uae" vs
// "Emirates") and can actually reach the 10-response display threshold.
const COUNTRIES = ['UAE', 'Egypt', 'Saudi Arabia', 'Kuwait', 'Qatar', 'Bahrain', 'Oman', 'Jordan', 'Lebanon', 'Other'];

// Mirrors the hardcoded UID in firestore.rules isAdmin().
const HARDCODED_ADMIN_UID = '7zNbw98m9jZYy8uTan7dqwolBud2';
import { Question, QuestionResult, UserProfile, Group, UserAnswer } from './types';
import { Toaster, toast } from 'sonner';
import { cn } from './lib/utils';
import { GameView } from './components/GameMode/GameView';

// --- Components ---

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
      className={cn(
        'px-4 py-2 rounded-full font-medium transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
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
    className={cn(
      'w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/20 transition-colors',
      className
    )}
  />
);

// --- Components ---


class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) errorMessage = `Database Error: ${parsed.error}`;
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center">
          <div className="space-y-4">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-2xl font-bold">{t("App Error")}</h2>
            <p className="text-zinc-500 max-w-xs mx-auto">{errorMessage}</p>
            <Button onClick={() => window.location.reload()}>{t("Reload App")}</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Main App ---

const REF_KEY = 'pulse.ref';
const sharedIdFromPath = () => {
  const m = window.location.pathname.match(/^\/q\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

function PulseApp() {
  const { user, loading, signUp, signIn, signOut, updateProfile, redeemReferral, resetPassword } = useAuth();
  const [sharedId, setSharedId] = useState<string | null>(sharedIdFromPath);
  const [sharedPreview, setSharedPreview] = useState<string | null>(null);

  // A shared link: remember the sharer's referral code through sign-up.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) { try { localStorage.setItem(REF_KEY, ref.toUpperCase()); } catch { /* ignore */ } }
    if (sharedId) {
      getDoc(doc(db, 'questions', sharedId)).then((snap) => snap.exists() && setSharedPreview(snap.data().text)).catch(() => {});
    }
  }, []);

  // Redeem it once the account exists (once only; never your own code).
  useEffect(() => {
    if (!user) return;
    let ref: string | null = null;
    try { ref = localStorage.getItem(REF_KEY); } catch { /* ignore */ }
    if (!ref) return;
    try { localStorage.removeItem(REF_KEY); } catch { /* ignore */ }
    if (user.referredBy || user.referralCode === ref) return;
    redeemReferral(ref).catch(() => {});
  }, [user?.uid]);

  // One session per app open, counted once the user is known.
  const sessionCounted = useRef(false);
  useEffect(() => {
    if (user && !sessionCounted.current) { sessionCounted.current = true; track(user.uid, 'sessions'); }
  }, [user?.uid]);

  const closeShared = () => {
    setSharedId(null);
    window.history.replaceState(null, '', '/');
  };
  const [activeTab, setActiveTab] = useState<'feed' | 'groups' | 'game' | 'my-questions' | 'profile'>('feed');
  const [showSignup, setShowSignup] = useState(false);
  const [showCreate, setShowCreate] = useState<{ open: boolean, groupId?: string }>({ open: false });
  const answers = useAnswerCount(user?.uid);
  useMemberProgress(user, answers, () => setShowCreate({ open: true }));
  useAuthorMilestones(user?.uid);
  // New members answer a few questions before the rest of the app opens.
  const entryLeft = user && answers !== null ? Math.max(0, ENTRY_ANSWERS - answers) : 0;
  const goTo = (tab: typeof activeTab) => {
    if (entryLeft > 0 && tab !== 'feed' && tab !== 'profile') {
      toast(`${t("Answer")} ${entryLeft} ${t("more to unlock this")}`);
      return;
    }
    setActiveTab(tab);
  };
  // Invite code from the link (?ref=), or remembered from an earlier visit.
  const [inviteCode, setInviteCode] = useState<string>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('ref');
    if (fromUrl) return fromUrl.toUpperCase();
    try { return localStorage.getItem(REF_KEY) ?? ''; } catch { return ''; }
  });
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'reset' | 'waitlist'>(() => (inviteCode ? 'signup' : 'signin'));
  const [username, setUsername] = useState(''); // email, or a legacy username at sign-in
  const [waitlisted, setWaitlisted] = useState(false);
  const [password, setPassword] = useState('');
  const [demographics, setDemographics] = useState({ ageRange: '', gender: '', country: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      setShowSignup(true);
    } else {
      setShowSignup(false);
    }
  }, [user, loading]);

  // Auth timeout fallback: if still loading after 10 seconds, force loading to false
  // to allow the app to at least show the signup screen
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        console.warn('Auth loading timeout reached. Forcing loading to false.');
        // We can't directly set loading in AuthProvider, but we can handle it here
        // if we had a way to override. Since we don't, we'll just log it for now.
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  const handleSignup = async () => {
    if (!inviteCode.trim()) { setAuthMode('waitlist'); return; }
    if (!username.includes('@')) return toast.error(t("Please enter a valid email address."));
    if (password.length < 6) return toast.error(t("Password must be at least 6 characters"));
    if (!demographics.ageRange || !demographics.gender || !demographics.country) {
      return toast.error(t("Please complete your profile details"));
    }
    setIsProcessing(true);
    try {
      // Kept until the referral is redeemed after sign-up.
      try { localStorage.setItem(REF_KEY, inviteCode.trim().toUpperCase()); } catch { /* ignore */ }
      await signUp(username, password, demographics, inviteCode);
      setShowSignup(false);
      toast.success(t("Welcome to Pulse!"));
    } catch (e: any) {
      if (e.code === 'invalid-invite') {
        try { localStorage.removeItem(REF_KEY); } catch { /* ignore */ }
        setInviteCode('');
      }
      toast.error(e.message || t('Sign-up failed. Try again.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignin = async () => {
    if (!username.trim()) return toast.error(t("Please enter your email"));
    if (!password) return toast.error(t("Please enter your password"));
    setIsProcessing(true);
    try {
      await signIn(username, password);
      setShowSignup(false);
      toast.success(t("Welcome back!"));
    } catch (e: any) {
      toast.error(e.message || t('Sign in failed.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = async () => {
    setIsProcessing(true);
    try {
      await resetPassword(username);
      toast.success(t("If that email has an account, a reset link is on its way."));
      setAuthMode('signin');
    } catch (e: any) {
      toast.error(e.message || t('Could not send the reset email.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWaitlist = async () => {
    const email = username.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast.error(t("Please enter a valid email address."));
    setIsProcessing(true);
    try {
      await addDoc(collection(db, 'waitlist'), { email, lang, createdAt: serverTimestamp() });
      setWaitlisted(true);
    } catch {
      toast.error(t('Could not join the waitlist. Try again.'));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-white selection:text-black">
      <Toaster position="top-center" theme="dark" />
      
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-black/80 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <TrendingUp className="text-black w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tighter">{t("PULSE")}</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {user && (
            <div className="flex items-center gap-2 sm:gap-3 bg-zinc-900/50 px-2 sm:px-3 py-1.5 rounded-full border border-white/5">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-bold">{user.credits}</span>
              <div className="hidden sm:block w-px h-3 bg-zinc-800" />
              <span className="hidden sm:block text-[10px] uppercase tracking-widest font-semibold text-zinc-500">{t("Credits")}</span>
            </div>
          )}
          {user && (
            <button 
              onClick={() => setActiveTab('profile')}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center border transition-all",
                activeTab === 'profile' ? 'bg-white border-white text-black' : 'bg-zinc-900 border-white/5 text-zinc-400 hover:text-white'
              )}
            >
              <User className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-20 pb-24 px-4 max-w-md mx-auto">
        {entryLeft > 0 && activeTab === 'feed' && (
          <div className="mb-4 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-2" data-testid="entry-progress">
            <p className="text-sm font-bold">{t("Welcome to Pulse. Answer")} {ENTRY_ANSWERS} {t("questions to get in.")}</p>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-white transition-all" style={{ width: `${((ENTRY_ANSWERS - entryLeft) / ENTRY_ANSWERS) * 100}%` }} />
            </div>
            <p className="text-[11px] text-zinc-500">{ENTRY_ANSWERS - entryLeft}/{ENTRY_ANSWERS} · {t("Groups, Games and asking unlock after that.")}</p>
          </div>
        )}
        {activeTab === 'feed' && <Feed />}
        {activeTab === 'groups' && <GroupsView />}
        {activeTab === 'game' && <GameView />}
        {activeTab === 'my-questions' && <MyQuestionsView />}
        {activeTab === 'profile' && <ProfileView answers={answers} />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black/80 backdrop-blur-md border-t border-white/5 px-6 py-4 flex items-center justify-between max-w-md mx-auto">
        <NavButton active={activeTab === 'feed'} onClick={() => goTo('feed')} icon={<Globe />} label={t("Feed")} />
        <NavButton active={activeTab === 'my-questions'} onClick={() => goTo('my-questions')} icon={<LayoutGrid />} label={t("My Qs")} />
        <div className="relative -top-6">
          <button 
            onClick={() => (entryLeft > 0 ? toast(`${t("Answer")} ${entryLeft} ${t("more to unlock this")}`) : setShowCreate({ open: true }))}
            className="w-14 h-14 bg-white text-black rounded-full flex items-center justify-center shadow-2xl shadow-white/20 active:scale-90 transition-transform"
          >
            <Plus className="w-8 h-8" />
          </button>
        </div>
        <NavButton active={activeTab === 'groups'} onClick={() => goTo('groups')} icon={<Users />} label={t("Groups")} />
        <NavButton active={activeTab === 'game'} onClick={() => goTo('game')} icon={<Gamepad2 />} label={t("Games")} />
      </nav>

      {/* Signup/Signin Modal */}
      <AnimatePresence>
        {showSignup && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex items-center justify-center p-6 overflow-y-auto"
          >
            <div className="w-full max-w-sm space-y-8 py-10">
              <div className="space-y-2 text-center">
                <h2 className="text-4xl font-bold tracking-tighter">
                  {authMode === 'signin' ? t("Welcome Back") : authMode === 'reset' ? t("Reset password") : authMode === 'waitlist' ? t("Pulse is invite-only") : t("Join Pulse")}
                </h2>
                <p className="text-zinc-500">{t("Radical anonymity. Pure honesty.")}</p>
                {sharedPreview && authMode !== 'waitlist' && (
                  <div className="mt-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-left space-y-1" data-testid="shared-teaser">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">{t("A friend sent you a question")}</p>
                    <p className="font-bold">{sharedPreview}</p>
                    <p className="text-xs text-zinc-400">{t("Sign up to answer it and see what everyone picked.")}</p>
                  </div>
                )}
                {authMode === 'signup' && inviteCode && (
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300" data-testid="invite-chip">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t("You've been invited by a member")}
                  </p>
                )}
                <LanguageToggle />
              </div>

              {authMode === 'waitlist' ? (
                waitlisted ? (
                  <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-6 text-center space-y-2" data-testid="waitlist-done">
                    <p className="text-2xl">🎟️</p>
                    <p className="font-bold">{t("You're on the list.")}</p>
                    <p className="text-sm text-zinc-400">{t("We'll email you when a spot opens. Know someone on Pulse? Their invite link gets you in straight away.")}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-zinc-400 text-center">{t("You join through a member's invite link. Ask a friend on Pulse for theirs, enter their code, or join the waitlist.")}</p>
                    <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder={t("Invite code")} />
                    <Button variant="secondary" className="w-full" disabled={!inviteCode.trim()} onClick={() => setAuthMode('signup')}>{t("Use invite code")}</Button>
                    <div className="h-px bg-zinc-800" />
                    <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("Your email")} type="email" />
                    <Button onClick={handleWaitlist} loading={isProcessing} className="w-full h-14 text-lg">{t("Join the waitlist")}</Button>
                  </div>
                )
              ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{authMode === 'signin' ? t("Email (or username)") : t("Email")}</label>
                  <Input 
                    value={username} 
                    onChange={(e) => setUsername(e.target.value)} 
                    type={authMode === 'signin' ? 'text' : 'email'}
                    placeholder={t("you@example.com")} 
                  />
                  {authMode === 'signup' && <p className="text-[10px] text-zinc-600 ml-1">{t("Only used to sign in and reset your password. Never shown to anyone.")}</p>}
                </div>

                {authMode !== 'reset' && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Password")}</label>
                  <Input 
                    type="password"
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    placeholder={t("Min 6 characters...")} 
                  />
                </div>
                )}
                
                {authMode === 'signup' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Age Range")}</label>
                        <select 
                          value={demographics.ageRange}
                          onChange={(e) => setDemographics({...demographics, ageRange: e.target.value})}
                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none"
                        >
                          <option value="">{t("Select...")}</option>
                          <option value="13-17">13-17</option>
                          <option value="18-24">18-24</option>
                          <option value="25-34">25-34</option>
                          <option value="35-44">35-44</option>
                          <option value="45+">45+</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Gender")}</label>
                        <select 
                          value={demographics.gender}
                          onChange={(e) => setDemographics({...demographics, gender: e.target.value})}
                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none"
                        >
                          <option value="">{t("Select...")}</option>
                          <option value="Male">{t("Male")}</option>
                          <option value="Female">{t("Female")}</option>
                          <option value="Non-binary">{t("Non-binary")}</option>
                          <option value="Other">{t("Other")}</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Country")}</label>
                      <select
                        value={demographics.country}
                        onChange={(e) => setDemographics({...demographics, country: e.target.value})}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none"
                      >
                        <option value="">{t("Select...")}</option>
                        {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>
              )}

              <div className="space-y-4">
                {authMode !== 'waitlist' && (
                <Button 
                  onClick={authMode === 'signin' ? handleSignin : authMode === 'reset' ? handleReset : handleSignup} 
                  loading={isProcessing} 
                  className="w-full h-14 text-lg"
                >
                  {authMode === 'signin' ? t("Sign In") : authMode === 'reset' ? t("Send reset link") : t("Create Account")}
                </Button>
                )}
                {authMode === 'signin' && (
                  <button onClick={() => setAuthMode('reset')} className="w-full text-zinc-500 text-sm hover:text-white transition-colors">
                    {t("Forgot password?")}
                  </button>
                )}
                <button 
                  onClick={() => setAuthMode(authMode === 'signin' ? (inviteCode ? 'signup' : 'waitlist') : 'signin')}
                  className="w-full text-zinc-500 text-sm hover:text-white transition-colors"
                >
                  {authMode === 'signin' ? t("Don't have an account? Sign Up") : t("Already have an account? Sign In")}
                </button>
              </div>
              
              <p className="text-[10px] text-center text-zinc-600 px-8">
                {t("Your data is encrypted and never shared. Pulse is built on trust and anonymity.")}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {user && sharedId && (
        <QuestionOverlay id={sharedId} label={t("A friend shared this question")} onClose={closeShared} />
      )}

      {/* Create Question Modal */}
      <AnimatePresence>
        {showCreate.open && (
          <CreateQuestionModal 
            onClose={() => setShowCreate({ open: false })} 
            groupId={showCreate.groupId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Share a question: native share sheet, WhatsApp, or a "my pick" story image. */
function ShareRow({ question, results, pick }: { question: Question; results: QuestionResult | null; pick: number | null }) {
  const { user } = useAuth();
  const country = user?.demographics?.country;
  const url = questionUrl(question.id, user?.memberNumber ? user.referralCode : undefined);
  const text = shareText(question, country);
  const share = async () => {
    const r = await shareLink(text, url);
    if (r !== 'cancelled') track(user?.uid, 'shares');
    if (r === 'copied') toast.success(t("Link copied"));
  };
  const myPick = async () => {
    if (pick === null || pick < 0 || !results) return;
    const c = results.counts || {};
    const total = (c['0'] || 0) + (c['1'] || 0);
    const pct = total ? Math.round(((c[String(pick)] || 0) / total) * 100) : 100;
    const blob = await pickCard(qText(question, country), qOptions(question, country)[pick], pct, url);
    const r = await sharePick(blob, text, url);
    track(user?.uid, 'shares');
    if (r === 'downloaded') toast.success(t("Image saved: post it to your story"));
  };
  return (
    <div className="flex gap-2" data-testid="share-row">
      <Button variant="outline" onClick={share} className="flex-1 h-11 text-sm">
        <Share2 className="w-4 h-4" /> {t("Share")}
      </Button>
      <a href={whatsappUrl(text, url)} target="_blank" rel="noopener noreferrer" onClick={() => track(user?.uid, 'shares')}
         className="flex-1 h-11 text-sm rounded-xl border border-green-500/30 text-green-400 flex items-center justify-center gap-2 hover:bg-green-500/10">
        <MessageCircle className="w-4 h-4" /> WhatsApp
      </a>
      {pick !== null && pick >= 0 && results && (
        <Button variant="outline" onClick={myPick} className="flex-1 h-11 text-sm">
          <ImageIcon className="w-4 h-4" /> {t("My pick")}
        </Button>
      )}
    </div>
  );
}

/** Daily featured question, picked by the daily bot (ops/questionOfDay). */
const QuestionOfTheDay = ({ answeredIds }: { answeredIds: Set<string> }) =>
  <FeaturedQuestion answeredIds={answeredIds} opsId="questionOfDay" label={t("Question of the day")} />;
/** Weekly pick from members' own questions (ops/questionOfWeek). The author stays anonymous. */
const QuestionOfTheWeek = ({ answeredIds }: { answeredIds: Set<string> }) =>
  <FeaturedQuestion answeredIds={answeredIds} opsId="questionOfWeek" label={t("Question of the week, asked by a member")} tone="violet" />;

function FeaturedQuestion({ answeredIds, opsId, label, tone = 'orange' }: { answeredIds: Set<string>; opsId: string; label: string; tone?: 'orange' | 'violet' }) {
  const { user } = useAuth();
  const [q, setQ] = useState<Question | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    getDoc(doc(db, 'ops', opsId))
      .then(async (s) => {
        if (!s.exists()) return;
        const qs = await getDoc(doc(db, 'questions', s.data().id));
        if (qs.exists() && qs.data().status === 'live') setQ({ id: qs.id, ...qs.data() } as Question);
      })
      .catch(() => {});
  }, []);
  if (!q) return null;
  const done = answeredIds.has(q.id);
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid={opsId === 'questionOfDay' ? 'qotd' : 'qotw'}
        className={cn('w-full text-left rounded-2xl border px-4 py-3 flex items-center gap-3',
          tone === 'orange' ? 'border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/15' : 'border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/15')}>
        {tone === 'orange' ? <Flame className="w-5 h-5 text-orange-400 shrink-0" /> : <Sparkles className="w-5 h-5 text-violet-400 shrink-0" />}
        <div className="min-w-0">
          <p className={cn('text-[10px] font-bold uppercase tracking-widest', tone === 'orange' ? 'text-orange-300' : 'text-violet-300')}>{label}</p>
          <p className="font-bold truncate">{qText(q, user?.demographics?.country)}</p>
        </div>
        <span className={cn('ml-auto text-xs shrink-0', tone === 'orange' ? 'text-orange-300' : 'text-violet-300')}>{done ? t("See results") : t("Answer")}</span>
      </button>
      {open && <QuestionOverlay id={q.id} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A single question opened from a shared link or the Question of the Day. */
function QuestionOverlay({ id, label, onClose }: { id: string; label: string; onClose: () => void }) {
  const [q, setQ] = useState<Question | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    getDoc(doc(db, 'questions', id))
      .then((snap) => (snap.exists() && ['live', 'retired'].includes(snap.data().status) ? setQ({ id: snap.id, ...snap.data() } as Question) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [id]);
  return (
    <div className="fixed inset-0 z-40 bg-black/90 backdrop-blur-sm overflow-y-auto p-4" data-testid="question-overlay">
      <div className="max-w-md mx-auto space-y-4 py-8">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-indigo-300">{label}</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-sm">{t("Close")}</button>
        </div>
        {q && <QuestionCard question={q} />}
        {missing && <p className="text-zinc-400 text-center py-10">{t("This question is no longer available.")}</p>}
      </div>
    </div>
  );
}

/** The question a submission was merged into, answerable in place. */
function OriginalQuestion({ id }: { id: string }) {
  const [q, setQ] = useState<Question | null>(null);
  useEffect(() => {
    getDoc(doc(db, 'questions', id)).then((snap) => snap.exists() && setQ({ id: snap.id, ...snap.data() } as Question)).catch(() => {});
  }, [id]);
  return q ? <QuestionCard question={q} /> : null;
}

function LanguageToggle() {
  const opts: Array<['en' | 'ar', string]> = [['en', 'English'], ['ar', 'العربية']];
  return (
    <div className="flex justify-center gap-2 pt-2" role="group" aria-label="Language">
      {opts.map(([code, label]) => (
        <button
          key={code}
          onClick={() => code !== lang && setLang(code)}
          aria-pressed={lang === code}
          className={cn(
            'px-4 py-1.5 rounded-full text-sm border transition-colors',
            lang === code ? 'bg-white text-black border-white' : 'border-zinc-800 text-zinc-400 hover:text-white'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1 transition-colors',
        active ? 'text-white' : 'text-zinc-600'
      )}
    >
      {React.isValidElement(icon) && React.cloneElement(icon as React.ReactElement<any>, { className: 'w-6 h-6' })}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}

// --- Feed Components ---

function Feed() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAllCaughtUp, setShowAllCaughtUp] = useState(false);
  const [revisitMode, setRevisitMode] = useState(false);
  const [revisitFilters, setRevisitFilters] = useState<any>(null);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  // The deck must not be built before the user's history has arrived, or it
  // includes everything they already answered (found by a returning user).
  const [historyReady, setHistoryReady] = useState({ answers: false, skips: false });
  const ready = historyReady.answers && historyReady.skips;
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    
    const unsubAnswers = onSnapshot(query(collection(db, 'user_answers'), where('userId', '==', user.uid)), (s) => {
      setAnsweredIds(new Set(s.docs.map(d => d.data().questionId)));
      setHistoryReady((r) => (r.answers ? r : { ...r, answers: true }));
    }, (error) => {
      console.error('Error listening to answers:', error);
      setHistoryReady((r) => ({ ...r, answers: true }));
    });

    const unsubSkips = onSnapshot(query(collection(db, 'skipped_questions'), where('userId', '==', user.uid)), (s) => {
      setSkippedIds(new Set(s.docs.map(d => d.data().questionId)));
      setHistoryReady((r) => (r.skips ? r : { ...r, skips: true }));
    }, (error) => {
      console.error('Error listening to skips:', error);
      setHistoryReady((r) => ({ ...r, skips: true }));
    });

    return () => {
      unsubAnswers();
      unsubSkips();
    };
  }, [user?.uid]);

  // Filter chips: the categories live questions actually have, busiest first.
  const [catChips, setCatChips] = useState<string[]>([]);
  const categories = ['All', ...catChips];

  const loadQuestions = async (isInitial: boolean = false) => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      if (revisitMode && revisitFilters) {
        // ... (revisit logic remains same)
        const [answersSnapshot, skipsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'user_answers'), where('userId', '==', user.uid), orderBy('answeredAt', 'desc'))),
          getDocs(query(collection(db, 'skipped_questions'), where('userId', '==', user.uid), orderBy('skippedAt', 'desc')))
        ]);

        const answers = answersSnapshot.docs.map(doc => ({ ...doc.data(), type: 'answered' } as any));
        const skips = skipsSnapshot.docs.map(doc => ({ ...doc.data(), type: 'skipped' } as any));
        
        let combined = [...answers, ...skips].sort((a, b) => {
          const dateA = new Date(a.answeredAt || a.skippedAt).getTime();
          const dateB = new Date(b.answeredAt || b.skippedAt).getTime();
          return dateB - dateA;
        });

        if (revisitFilters.answerType !== 'Both') {
          combined = combined.filter(item => {
            if (item.type !== 'answered') return false;
            const isOption0 = item.answerIndex === 0;
            const isMajority = isOption0 ? item.option0PercentAtTime > 50 : item.option1PercentAtTime > 50;
            return revisitFilters.answerType === 'Majority' ? isMajority : !isMajority;
          });
        }

        if (revisitFilters.timeRange !== 'Any time') {
          const months = revisitFilters.timeRange === '3+ months ago' ? 3 : 6;
          const cutoff = new Date();
          cutoff.setMonth(cutoff.getMonth() - months);
          combined = combined.filter(item => new Date(item.answeredAt || item.skippedAt) < cutoff);
        }

        const questionIds = Array.from(new Set(combined.map(a => a.questionId)));
        if (questionIds.length === 0) {
          setQuestions([]);
          setLoading(false);
          return;
        }

        const allQuestions: Question[] = [];
        for (let i = 0; i < questionIds.length; i += 10) {
          const chunk = questionIds.slice(i, i + 10);
          const q = query(collection(db, 'questions'), where('__name__', 'in', chunk));
          const snapshot = await getDocs(q);
          allQuestions.push(...snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question)));
        }

        let finalQuestions = allQuestions;
        if (!revisitFilters.categories.includes('All Categories')) {
          finalQuestions = allQuestions.filter(q => revisitFilters.categories.includes(q.category));
        }

        setQuestions(finalQuestions);
        if (isInitial) setCurrentIndex(0);
        setLoading(false);
        return;
      }

      // Normal feed logic
      let q = query(
        collection(db, 'questions'),
        where('status', '==', 'live'),
        where('isPublic', '==', true),
        limit(500)
      );

      if (selectedCategory && selectedCategory !== 'All') {
        q = query(
          collection(db, 'questions'),
          where('status', '==', 'live'),
          where('isPublic', '==', true),
          where('category', '==', selectedCategory),
          limit(500)
        );
      }

      const questionsSnapshot = await getDocs(q);
      let qs = questionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));
      
      if (!selectedCategory || selectedCategory === 'All') setCatChips(categoriesByCount(qs));

      // What this user likes, from the categories they answered vs skipped.
      const catOf = new Map(qs.map((x) => [x.id, x.category]));
      const interest = categoryInterest(
        [...answeredIds].map((id) => catOf.get(id)).filter(Boolean) as string[],
        [...skippedIds].map((id) => catOf.get(id)).filter(Boolean) as string[],
      );

      // Filter using the real-time sets
      qs = qs.filter(q => !answeredIds.has(q.id) && !skippedIds.has(q.id));
      
      // Ranked order: best first for new users, then a proven/exploring/wildcard
      // mix. Ranks come from the nightly ranking job. See src/lib/feedOrder.ts.
      qs = orderFeed(qs, answeredIds.size, { uid: user!.uid, country: user?.demographics?.country, interest });
      
      setQuestions(qs);
      if (isInitial) {
        setCurrentIndex(0);
        setShowAllCaughtUp(qs.length === 0);
      }
      setLoading(false);
    } catch (error) {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'questions');
    }
  };

  useEffect(() => {
    if (!ready) return;
    loadQuestions(true);
  }, [selectedCategory, user?.uid, revisitMode, revisitFilters, ready]);

  const handleNext = async (isAnswered: boolean = false) => {
    if (!user) return;
    
    // If skipping (not answered), record it permanently
    if (!isAnswered) {
      try {
        const skipId = `${user.uid}_${questions[currentIndex].id}`;
        await setDoc(doc(db, 'skipped_questions', skipId), {
          userId: user.uid,
          questionId: questions[currentIndex].id,
          skippedAt: new Date().toISOString()
        });
        track(user.uid, 'skips');
        toast.info(t("Question skipped. You can find it in your history later."));
        
        // Remove from local state to prevent "return back" in same session
        const newQuestions = questions.filter((_, i) => i !== currentIndex);
        setQuestions(newQuestions);
        
        // If we were at the last item, we are now "caught up"
        if (currentIndex >= newQuestions.length) {
          if (!revisitMode) setShowAllCaughtUp(true);
        }
        return;
      } catch (error) {
        console.error('Error recording skip:', error);
      }
    }

    // If answered, we also remove it from local state to prevent repeating
    if (isAnswered) {
      const newQuestions = questions.filter((_, i) => i !== currentIndex);
      setQuestions(newQuestions);
      if (currentIndex >= newQuestions.length) {
        if (!revisitMode) setShowAllCaughtUp(true);
      }
      return;
    }

    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      // Last question reached
      if (!revisitMode) {
        setShowAllCaughtUp(true);
      }
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  if (loading && questions.length === 0) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-white/10 border-t-white rounded-full animate-spin" /></div>;

  const currentQuestion = questions[currentIndex];

  return (
    <div className="space-y-6">
      {!revisitMode && <QuestionOfTheDay answeredIds={answeredIds} />}
      {!revisitMode && <KnockoutBanner />}
      {!revisitMode && <QuestionOfTheWeek answeredIds={answeredIds} />}
      {revisitMode && (
        <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/20 rounded-2xl px-4 py-2">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">{t("Revisit Mode")}</span>
          </div>
          <button 
            onClick={() => {
              setRevisitMode(false);
              setRevisitFilters(null);
              setShowAllCaughtUp(false);
            }}
            className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white"
          >
            {t("Exit")}
          </button>
        </div>
      )}

      {/* Category Bar */}
      {!revisitMode && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar -mx-4 px-4">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === 'All' ? null : cat)}
              className={cn(
                'px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border',
                (selectedCategory === cat || (cat === 'All' && !selectedCategory))
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-900 text-zinc-500 border-white/5 hover:border-white/20'
              )}
            >
              {cat === 'All' ? t("All") : t(cat)}
            </button>
          ))}
        </div>
      )}

      {questions.length === 0 ? (
        <div className="text-center py-20 space-y-4">
          <LayoutGrid className="w-12 h-12 text-zinc-800 mx-auto" />
          <p className="text-zinc-500">{t("No questions in this category yet.")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <button
              onClick={handlePrev}
              disabled={currentIndex === 0}
              className="p-2 rounded-full bg-zinc-900 border border-white/5 text-zinc-400 disabled:opacity-0 transition-all hover:bg-zinc-800"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-1.5">
              {questions.slice(0, Math.min(questions.length, 10)).map((_, i) => (
                <div 
                  key={i}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    i === currentIndex ? 'w-8 bg-white' : 'w-2 bg-zinc-800'
                  )}
                />
              ))}
              {questions.length > 10 && <span className="text-[10px] text-zinc-600 font-bold ml-1">...</span>}
            </div>

            <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest tabular-nums">
              {currentIndex + 1} / {questions.length}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <QuestionCard 
              key={currentQuestion.id} 
              question={currentQuestion} 
              revisitMode={revisitMode}
              onAnswer={() => {
                // Only auto-advance if revisitMode is false
                if (!revisitMode) {
                  // Auto-advance after a short delay to show results
                  setTimeout(() => {
                    handleNext(true);
                  }, 2000);
                }
              }}
              onNext={() => handleNext(false)}
              isLast={currentIndex === questions.length - 1}
            />
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {showAllCaughtUp && (
          <AllCaughtUpScreen 
            onClose={() => setShowAllCaughtUp(false)}
            onRevisit={(filters) => {
              setRevisitFilters(filters);
              setRevisitMode(true);
              setShowAllCaughtUp(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function AllCaughtUpScreen({ onClose, onRevisit }: { onClose: () => void, onRevisit: (filters: any) => void }) {
  const [answerType, setAnswerType] = useState('Both');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['All Categories']);
  const [timeRange, setTimeRange] = useState('Any time');

  const categories = ['All Categories', ...ALL_CATEGORIES];

  const handleCategoryToggle = (cat: string) => {
    if (cat === 'All Categories') {
      setSelectedCategories(['All Categories']);
      return;
    }
    
    setSelectedCategories(prev => {
      const filtered = prev.filter(c => c !== 'All Categories');
      if (filtered.includes(cat)) {
        const next = filtered.filter(c => c !== cat);
        return next.length === 0 ? ['All Categories'] : next;
      }
      return [...filtered, cat];
    });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto border border-indigo-500/20 mb-4">
            <PartyPopper className="w-10 h-10 text-indigo-400" />
          </div>
          <h2 className="text-3xl font-bold tracking-tighter">{t("You're all caught up!")}</h2>
          <p className="text-zinc-500">{t("You've answered everything in your feed. 🎉")}</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Your Answer Type")}</label>
            <div className="flex gap-2">
              {['Minority', 'Majority', 'Both'].map(type => (
                <button
                  key={type}
                  onClick={() => setAnswerType(type)}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-xs font-bold border transition-all",
                    answerType === type ? 'bg-white text-black border-white' : 'bg-zinc-900 text-zinc-500 border-white/5'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Categories")}</label>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => handleCategoryToggle(cat)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                    selectedCategories.includes(cat) ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-zinc-900 text-zinc-500 border-white/5'
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Time Since Answered")}</label>
            <div className="flex gap-2">
              {['3+ months ago', '6+ months ago', 'Any time'].map(time => (
                <button
                  key={time}
                  onClick={() => setTimeRange(time)}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all",
                    timeRange === time ? 'bg-white text-black border-white' : 'bg-zinc-900 text-zinc-500 border-white/5'
                  )}
                >
                  {time}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4">
          <Button 
            onClick={() => onRevisit({ answerType, categories: selectedCategories, timeRange })}
            className="w-full h-14 rounded-2xl text-lg font-bold bg-indigo-500 hover:bg-indigo-400"
          >
            {t("Revisit Questions")}
          </Button>
          <button 
            onClick={onClose}
            className="w-full py-2 text-sm font-bold text-zinc-500 hover:text-zinc-300"
          >
            {t("Not now")}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function QuestionCard({ 
  question, 
  onAnswer, 
  onNext,
  isLast,
  showBoost = false,
  revisitMode = false
}: { 
  question: Question, 
  onAnswer?: () => void,
  onNext?: () => void,
  isLast?: boolean,
  showBoost?: boolean,
  revisitMode?: boolean
}) {
  const { user, updateProfile } = useAuth();
  const [answered, setAnswered] = useState(false);
  const [previousAnswer, setPreviousAnswer] = useState<any>(null);
  const [results, setResults] = useState<QuestionResult | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [demographicsUnlocked, setDemographicsUnlocked] = useState(false);
  const [currentAnswerIndex, setCurrentAnswerIndex] = useState<number | null>(null);

  // Check if demographics are unlocked
  useEffect(() => {
    if (!user || !question.id) return;
    const unlockRef = doc(db, 'users', user.uid, 'unlockedDemographics', question.id);
    return onSnapshot(unlockRef, (doc) => {
      setDemographicsUnlocked(doc.exists());
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/unlockedDemographics/${question.id}`);
    });
  }, [user, question.id]);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // Check if user already answered
    const checkAnswered = async () => {
      const answerId = `${user.uid}_${question.id}`;
      const answerDoc = await getDoc(doc(db, 'user_answers', answerId));
      if (answerDoc.exists()) {
        const data = answerDoc.data();
        setAnswered(true);
        setPreviousAnswer(data);
        setCurrentAnswerIndex(data.answerIndex !== undefined ? data.answerIndex : data.optionIndex);
      }
    };
    checkAnswered();

    // Listen for results
    const unsubResults = onSnapshot(doc(db, 'results', question.id), (doc) => {
      if (doc.exists()) {
        setResults({ id: doc.id, ...doc.data() } as QuestionResult);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `results/${question.id}`);
    });

    return () => unsubResults();
  }, [user, question.id]);

  const handleVote = async (optionIndex: number) => {
    if (!user || (answered && !revisitMode) || voting) return;
    
    const isRevisit = answered && revisitMode;

    // Optimistic Update
    setAnswered(true);
    setVoting(true);
    setCurrentAnswerIndex(optionIndex);

    // Optimistically update results locally
    if (!isRevisit) {
      const newResults = results ? {
        ...results,
        counts: {
          ...results.counts,
          [optionIndex.toString()]: (results.counts[optionIndex.toString()] || 0) + 1
        }
      } : {
        id: question.id,
        counts: { [optionIndex.toString()]: 1 },
        demographics: { ageRange: {}, gender: {}, country: {} }
      };
      setResults(newResults as QuestionResult);
    }

    try {
      const answerId = `${user.uid}_${question.id}`;
      const answerRef = doc(db, 'user_answers', answerId);
      
      // 2. Update aggregated results
      const resultRef = doc(db, 'results', question.id);
      const resultDoc = await getDoc(resultRef);
      
      // Calculate current percentage split for revisit logic
      const currentCounts = resultDoc.exists() ? resultDoc.data().counts : { '0': 0, '1': 0 };
      const total = (currentCounts['0'] || 0) + (currentCounts['1'] || 0);
      const p0 = total > 0 ? Math.round(((currentCounts['0'] || 0) / total) * 100) : 50;
      const p1 = 100 - p0;

      // 1. Record that user answered (anonymously)
      const answerData: any = {
        userId: user.uid,
        questionId: question.id,
        answerIndex: optionIndex,
        answeredAt: new Date().toISOString(),
        option0PercentAtTime: p0,
        option1PercentAtTime: p1
      };

      if (isRevisit) {
        answerData.isRevisit = true;
      }

      if (isRevisit) {
        await setDoc(answerRef, answerData);
      } else {
        // Answer record, vote and +1 credit in one write: the rules refuse a
        // vote or credit that is not created together with the answer record,
        // so neither can be replayed. See src/lib/votes.ts.
        await castVote(db, user.uid, question.id, optionIndex as 0 | 1, user.demographics, answerData);
      }

      if (!isRevisit) {
        toast.success(t("Vote recorded anonymously! +1 Credit"));
        track(user.uid, 'answers');
        window.dispatchEvent(new Event('pulse:answered'));
      } else {
        toast.success(t("Answer updated!"));
      }

      if (onAnswer) onAnswer();
    } catch (e) {
      console.error('Vote error:', e);
      // Rollback optimistic update on error
      if (!isRevisit) {
        setAnswered(false);
      }
      // The listener will eventually sync the results back
      toast.error(t("Failed to record vote. Please try again."));
    } finally {
      setVoting(false);
    }
  };

  const [showBoostConfirm, setShowBoostConfirm] = useState(false);

  const handleBoost = async () => {
    if (!user) return;

    try {
      // Balance check and both writes happen inside one transaction, so a
      // stale credits value on this client cannot overdraw the account and a
      // failed impressions write cannot leave the user charged for nothing.
      await boostQuestion(db, user.uid, question.id);
      toast.success(t("Question boosted! +100 impressions"));
      setShowBoostConfirm(false);
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        toast.error(error.message);
        return;
      }
      handleFirestoreError(error, OperationType.UPDATE, `questions/${question.id}`);
    }
  };

  const handleUnlockDemographics = async () => {
    if (!user) return;

    setIsUnlocking(true);
    try {
      // Idempotent: a question already unlocked is never charged again, even
      // if this fires twice from two devices.
      const charged = await unlockDemographics(db, user.uid, question.id);
      toast.success(charged ? 'Demographics unlocked! -3 Credits' : 'Demographics unlocked');
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        toast.error(error.message);
        return;
      }
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/unlockedDemographics/${question.id}`);
    } finally {
      setIsUnlocking(false);
    }
  };

  const [showFlagConfirm, setShowFlagConfirm] = useState(false);

  const handleFlag = async (reason: 'unclear' | 'inappropriate') => {
    if (!user) return;
    if (question.authorUid === user.uid) {
      toast.error(t("You can't flag your own question."));
      setShowFlagConfirm(false);
      return;
    }
    try {
      const questionRef = doc(db, 'questions', question.id);
      const questionDoc = await getDoc(questionRef);
      const currentFlags = (questionDoc.data()?.flags || 0) + 1;
      
      const updateData: any = {
        flags: increment(1),
        [`flags_${reason}`]: increment(1)
      };

      // Auto-hide if flagged 5+ times
      if (currentFlags >= 5) {
        updateData.status = 'flagged';
      }

      await updateDoc(questionRef, updateData);
      toast.success(`Question flagged as ${reason}. Our moderators will review it.`);
      setShowFlagConfirm(false);
      if (onNext) onNext();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `questions/${question.id}`);
    }
  };

  const totalVotes = results ? (results.counts['0'] || 0) + (results.counts['1'] || 0) : 0;
  const p1 = totalVotes > 0 ? Math.round(((results?.counts['0'] || 0) / totalVotes) * 100) : 0;
  const p2 = totalVotes > 0 ? 100 - p1 : 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 space-y-6"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-500">
          {question.isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
          <span className="text-[10px] font-bold uppercase tracking-widest">
            {question.isPublic ? (question.category || t("Public Poll")) : t("Private Group")}
          </span>
          {revisitMode && (
            <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 text-[8px] font-black rounded uppercase tracking-widest border border-indigo-500/20">
              {t("Revisit")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {showBoost && (
            <button 
              onClick={() => setShowBoostConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-full transition-colors border border-indigo-500/20"
            >
              <Zap className="w-3 h-3 text-indigo-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">{t("Boost")}</span>
            </button>
          )}
          <motion.div 
            key={totalVotes}
            initial={{ scale: 1.2, color: '#fff' }}
            animate={{ scale: 1, color: '#52525b' }}
            className="text-[10px] font-bold uppercase tracking-widest tabular-nums"
          >
            {totalVotes} {t("Votes")}
          </motion.div>
          <button 
            onClick={() => setShowFlagConfirm(true)}
            className="p-1.5 text-zinc-700 hover:text-red-500 transition-colors"
            title={t("Flag Question")}
          >
            <Flag className="w-4 h-4" />
          </button>
          {!answered && onNext && !isLast && (
            <button 
              onClick={onNext}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors border border-white/5 px-2 py-1 rounded-full bg-white/5"
            >
              {t("Skip")}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <h3 className="text-2xl font-bold leading-tight tracking-tight">
        {qText(question, user?.demographics?.country)}
      </h3>

      <div className="space-y-3">
        {qOptions(question, user?.demographics?.country).map((opt, i) => (
          <button
            key={i}
            disabled={answered || voting}
            onClick={() => handleVote(i)}
            className={cn(
              'w-full relative h-16 rounded-2xl border transition-all overflow-hidden group',
              answered 
                ? 'border-white/5 bg-zinc-900/20' 
                : 'border-zinc-800 hover:border-white/20 active:scale-[0.98]'
            )}
          >
            {/* Progress Bar */}
            {answered && (
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${i === 0 ? p1 : p2}%` }}
                className={cn(
                  'absolute inset-y-0 left-0 bg-white/5',
                  (i === 0 ? p1 : p2) > 50 && 'bg-white/10'
                )}
              />
            )}

            <div className="relative z-10 px-6 flex items-center justify-between h-full">
              <div className="flex flex-col items-start">
                <span className={cn(
                  'font-medium transition-colors',
                  answered ? 'text-zinc-400' : 'text-white'
                )}>
                  {opt}
                </span>
                {answered && revisitMode && previousAnswer && (previousAnswer.answerIndex === i || previousAnswer.optionIndex === i) && (
                  <span className="text-[8px] font-black uppercase tracking-widest text-indigo-400 mt-0.5">
                    {t("Previously")}
                  </span>
                )}
              </div>
              {answered && (
                <div className="flex flex-col items-end">
                  <span className="text-xl font-bold tabular-nums">
                    {i === 0 ? p1 : p2}%
                  </span>
                  {revisitMode && previousAnswer && (
                    <span className={cn(
                      "text-[8px] font-bold tabular-nums",
                      (i === 0 ? p1 - previousAnswer.option0PercentAtTime : p2 - previousAnswer.option1PercentAtTime) > 0 ? "text-green-500" : "text-red-500"
                    )}>
                      {(i === 0 ? p1 - previousAnswer.option0PercentAtTime : p2 - previousAnswer.option1PercentAtTime) > 0 ? '+' : ''}
                      {i === 0 ? p1 - previousAnswer.option0PercentAtTime : p2 - previousAnswer.option1PercentAtTime}{t("% shift")}
                    </span>
                  )}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {answered && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pt-4 border-t border-white/5 space-y-4"
        >
          {totalVotes >= (question.isPublic ? 10 : 5) ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-zinc-400">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-widest">{t("Insights")}</span>
                </div>
                {!demographicsUnlocked && (
                  <button 
                    onClick={handleUnlockDemographics}
                    disabled={isUnlocking}
                    className="flex items-center gap-1.5 px-3 py-1 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <Lock className="w-3 h-3 text-zinc-500" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      {isUnlocking ? t("Unlocking...") : t("Unlock — 3 Credits")}
                    </span>
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-1 gap-4 relative">
                {!demographicsUnlocked && (
                  <div className="absolute inset-0 bg-zinc-900/60 backdrop-blur-md z-10 rounded-2xl flex flex-col items-center justify-center p-4 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">{t("Detailed Breakdown Locked")}</p>
                    <button 
                      onClick={handleUnlockDemographics}
                      className="text-[10px] font-bold uppercase tracking-widest text-white underline decoration-white/20 underline-offset-4"
                    >
                      {t("Use 3 credits to unlock")}
                    </button>
                  </div>
                )}
                <div className={cn("space-y-4", !demographicsUnlocked && 'opacity-20 grayscale pointer-events-none')}>
                  <DemographicBreakdown label={t("Age Range")} data={results?.demographics?.ageRange} />
                  <DemographicBreakdown label={t("Gender")} data={results?.demographics?.gender} />
                  {demographicsUnlocked && <DemographicBreakdown label={t("Country")} data={results?.demographics?.country} />}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center space-y-2">
              <Lock className="w-4 h-4 text-zinc-700 mx-auto" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t("Insufficient data to protect anonymity")}</p>
              <p className="text-[10px] text-zinc-600">{t("Requires")} {question.isPublic ? '10+' : '5+'} {'responses to reveal detailed insights.'}</p>
            </div>
          )}
          
          <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-medium">
            <ShieldCheck className="w-3 h-3" />
            <span>{t("Your answer is anonymous. Aggregated data only.")}</span>
          </div>

          {question.isPublic && (
            <ShareRow question={question} results={results} pick={currentAnswerIndex} />
          )}

          {onNext && (
            <button
              onClick={onNext}
              disabled={isLast}
              className={cn(
                "w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] mt-4",
                isLast 
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                  : 'bg-white text-black hover:bg-zinc-200'
              )}
            >
              <span>{isLast ? t("End of Feed") : t("Next Question")}</span>
              {!isLast && <ChevronRight className="w-5 h-5" />}
            </button>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {showFlagConfirm && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute inset-0 z-50 bg-zinc-950/90 backdrop-blur-sm rounded-3xl flex items-center justify-center p-6 text-center"
        >
          <div className="space-y-6">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
              <Flag className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">{t("Flag Question?")}</h3>
              <p className="text-zinc-500 text-sm max-w-[240px] mx-auto">
                {t("Why are you flagging this question? It will be hidden from your feed.")}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[240px] mx-auto">
              <button
                onClick={() => handleFlag('unclear')}
                className="w-full px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold hover:bg-white/10 transition-all text-left flex items-center justify-between group"
              >
                <span>{t("Unclear question")}</span>
                <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <button
                onClick={() => handleFlag('inappropriate')}
                className="w-full px-6 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm font-bold hover:bg-red-500/20 transition-all text-left flex items-center justify-between group text-red-400"
              >
                <span>{t("Inappropriate question")}</span>
                <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <button
                onClick={() => setShowFlagConfirm(false)}
                className="w-full px-6 py-3 rounded-xl text-xs font-bold text-zinc-500 hover:text-white transition-all"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {showBoostConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-xs bg-zinc-900 border border-white/10 rounded-[2rem] p-8 text-center space-y-6"
            >
              <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto border border-indigo-500/20">
                <Zap className="w-8 h-8 text-indigo-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold">{t("Boost Question?")}</h3>
                <p className="text-zinc-500 text-sm">
                  {t("Show your question to 100 additional users for 10 credits.")}
                </p>
              </div>
              <div className="space-y-3">
                <Button onClick={handleBoost} className="w-full bg-indigo-500 hover:bg-indigo-400 text-white">
                  {t("Confirm Boost")}
                </Button>
                <button 
                  onClick={() => setShowBoostConfirm(false)}
                  className="w-full py-3 text-sm font-bold text-zinc-500 hover:text-zinc-300"
                >
                  {t("Cancel")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DemographicBreakdown({ label, data }: { label: string, data?: any }) {
  if (!data) return null;

  return (
    <div className="space-y-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">{label}</span>
      <div className="space-y-1.5">
        {Object.entries(data).map(([key, counts]: [string, any]) => {
          const total = (counts['0'] || 0) + (counts['1'] || 0);
          if (total < 10) return null; // Anonymity threshold
          const p = Math.round(((counts['0'] || 0) / total) * 100);
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-zinc-400 w-12">{key}</span>
              <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden flex">
                <div style={{ width: `${p}%` }} className="h-full bg-white/40" />
                <div style={{ width: `${100 - p}%` }} className="h-full bg-white/10" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500">{p}% / {100 - p}%</span>
            </div>
          );
        })}
        {Object.values(data).every((c: any) => (c['0'] || 0) + (c['1'] || 0) < 10) && (
          <p className="text-[10px] text-zinc-700 italic">{t("Insufficient data for breakdown")}</p>
        )}
      </div>
    </div>
  );
}

// --- Modals ---

function CreateQuestionModal({ onClose, groupId }: { onClose: () => void, groupId?: string }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [opt1, setOpt1] = useState('');
  const [opt2, setOpt2] = useState('');
  const [category, setCategory] = useState(POST_CATEGORIES[0]);
  const [loading, setLoading] = useState(false);
  const [similarQ, setSimilarQ] = useState<(IndexItem & { score: number }) | null>(null);
  const [dupChoice, setDupChoice] = useState<'none' | 'answer' | 'different'>('none');
  const [existing, setExisting] = useState<Question | null>(null);

  // Duplicate check as the user types (public questions only).
  useEffect(() => {
    if (groupId || text.trim().length < 12) { setSimilarQ(null); return; }
    const timer = setTimeout(async () => {
      const match = findSimilar(text, [opt1, opt2], await loadQuestionIndex(), 0.5);
      setSimilarQ((prev) => (prev?.id === match?.id ? prev : match));
      if (match?.id !== similarQ?.id) { setDupChoice('none'); setExisting(null); }
    }, 350);
    return () => clearTimeout(timer);
  }, [text, opt1, opt2, groupId]);

  const answerExisting = async () => {
    if (!similarQ) return;
    setDupChoice('answer');
    const snap = await getDoc(doc(db, 'questions', similarQ.id));
    if (snap.exists()) setExisting({ id: snap.id, ...snap.data() } as Question);
  };

  const categories = POST_CATEGORIES;

  const handlePublish = async () => {
    if (!user) return;
    if (!text.trim() || !opt1.trim() || !opt2.trim()) return toast.error(t("Fill all fields"));
    
    // Group and public questions are now free
    if (!groupId) {
      if (!user.isVerified) return toast.error(t("Phone verification required to post"));
    }

    setLoading(true);
    try {
      // Public questions always enter as 'pending': the rules refuse anything
      // else, because a verdict computed on the phone cannot be trusted.
      // Moderation runs server-side and is the only path to 'live'. Group
      // questions are private to invited members and go live directly.
      const status = groupId ? 'live' : 'pending';

      // Create Question
      try {
        await addDoc(collection(db, 'questions'), {
          text,
          options: [opt1, opt2],
          category,
          authorUid: user.uid,
          isPublic: !groupId,
          groupId: groupId || null,
          createdAt: new Date().toISOString(),
          status,
          ...(similarQ ? { possibleDuplicateOf: similarQ.id } : {}),
          flags: 0,
          random: Math.random(),
          boostCount: 0
        });
      } catch (error) {
        // Do not fall through to a success toast — the question was not saved.
        handleFirestoreError(error, OperationType.CREATE, 'questions');
        toast.error(t("Could not save your question. Please try again."));
        setLoading(false);
        return;
      }

      if (status === 'pending') {
        toast.success(t("Submitted! Your question goes live once it passes review."), { duration: 6000 });
      } else {
        toast.success(t("Group question live!"));
      }
      onClose();
    } catch (e) {
      toast.error(t("Failed to publish"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
    >
      <motion.div 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="w-full max-w-sm bg-zinc-900 border border-white/10 rounded-[2rem] p-8 space-y-8"
      >
        <div className="flex items-center justify-between">
          <button 
            onClick={onClose} 
            className="flex items-center gap-1 p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-400 hover:text-white"
            id="back-button"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm font-medium">{t("Back")}</span>
          </button>
          <h2 className="text-xl font-bold tracking-tighter">{t("New Question")}</h2>
          <div className="w-16" /> {/* Spacer to balance the layout */}
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("The Question")}</label>
            <textarea 
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("What's on your mind?")}
              maxLength={100}
              className="w-full bg-black border border-zinc-800 rounded-2xl px-4 py-4 text-white placeholder:text-zinc-700 focus:outline-none focus:border-white/20 h-24 resize-none"
            />
          </div>

          {similarQ && dupChoice !== 'different' && (
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4 space-y-3" data-testid="duplicate-panel">
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">{t("Someone already asked this")}</p>
              <p className="font-bold leading-tight">{similarQ.t}</p>
              {dupChoice === 'answer' && existing ? (
                <QuestionCard question={existing} />
              ) : (
                <div className="flex gap-2">
                  <Button onClick={answerExisting} className="flex-1">{t("Answer it")}</Button>
                  <Button variant="outline" onClick={() => setDupChoice('different')} className="flex-1">{t("Mine is different")}</Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Category")}</label>
            <select 
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-black border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/20"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{t(cat)}</option>
              ))}
            </select>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Option A")}</label>
              <Input value={opt1} onChange={(e) => setOpt1(e.target.value)} placeholder={t("First choice...")} maxLength={40} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Option B")}</label>
              <Input value={opt2} onChange={(e) => setOpt2(e.target.value)} placeholder={t("Second choice...")} maxLength={40} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2 text-zinc-500">
              <Globe className="w-4 h-4" />
              <span className="text-xs font-medium">{t("Posting to")} {groupId ? t("Group") : t("Public Feed")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-green-500">{t("Free")}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-zinc-500 px-2">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs font-medium">{t("Reviewed before going live")}</span>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="flex-1 h-14 rounded-2xl border border-zinc-800 font-bold hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
              id="cancel-button"
            >
              {t("Cancel")}
            </button>
            <Button onClick={handlePublish} loading={loading} className="flex-[2] h-14 text-lg">
              {t("Publish")}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Placeholder Views ---

const generateInviteCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

function GroupsView() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'groups'),
      where('members', 'array-contains', user.uid)
    );
    return onSnapshot(q, (s) => {
      setGroups(s.docs.map(d => ({ id: d.id, ...d.data() } as Group)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'groups');
      setLoading(false);
    });
  }, [user]);

  if (selectedGroup) {
    return <GroupHome group={selectedGroup} onBack={() => setSelectedGroup(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tighter">{t("Private Groups")}</h2>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowJoin(true)}
            className="p-2 bg-zinc-900 border border-white/5 rounded-xl text-zinc-400 hover:text-white transition-colors"
          >
            <UserPlus className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setShowCreate(true)}
            className="p-2 bg-white text-black rounded-xl hover:bg-zinc-200 transition-colors"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-20 space-y-4 bg-zinc-900/30 border border-white/5 rounded-[2rem]">
          <Users className="w-12 h-12 text-zinc-800 mx-auto" />
          <div className="space-y-1">
            <h3 className="font-bold">{t("No Groups Yet")}</h3>
            <p className="text-zinc-500 text-sm px-8">{t("Create a private circle or join one with an invite code.")}</p>
          </div>
          <div className="flex gap-2 justify-center pt-4">
            <Button variant="outline" onClick={() => setShowJoin(true)}>{t("Join Group")}</Button>
            <Button onClick={() => setShowCreate(true)}>{t("Create Group")}</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {groups.map(group => (
            <button
              key={group.id}
              onClick={() => setSelectedGroup(group)}
              className="flex items-center justify-between p-6 bg-zinc-900/50 border border-white/5 rounded-3xl hover:bg-zinc-900 transition-colors text-left"
            >
              <div className="space-y-1">
                <h3 className="font-bold text-lg">{group.name}</h3>
                <div className="flex items-center gap-2 text-zinc-500 text-xs">
                  <Users className="w-3 h-3" />
                  <span>{group.memberCount} {t("Members")}</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-700" />
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateGroupModal onClose={() => setShowCreate(false)} onCreated={(g) => setSelectedGroup(g)} />
        )}
        {showJoin && (
          <JoinGroupModal onClose={() => setShowJoin(false)} onJoined={(g) => setSelectedGroup(g)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function GroupHome({ group, onBack }: { group: Group, onBack: () => void }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'feed' | 'members'>('feed');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [revisitMode, setRevisitMode] = useState(false);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    
    const q = query(
      collection(db, 'questions'),
      where('groupId', '==', group.id),
      orderBy('createdAt', 'desc')
    );
    
    const unsubQuestions = onSnapshot(q, (s) => {
      // Unlike the public feed, this query cannot filter on status without a
      // composite index, so hold non-live questions back here. A question that
      // moderation could not clear must not be visible to the group either.
      setQuestions(
        s.docs
          .map(d => ({ id: d.id, ...d.data() } as Question))
          .filter(q => q.status === 'live')
      );
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'group_questions');
      setLoading(false);
    });

    const unsubAnswers = onSnapshot(query(collection(db, 'user_answers'), where('userId', '==', user.uid)), (s) => {
      setAnsweredIds(new Set(s.docs.map(d => d.data().questionId)));
    });

    const unsubSkips = onSnapshot(query(collection(db, 'skipped_questions'), where('userId', '==', user.uid)), (s) => {
      setSkippedIds(new Set(s.docs.map(d => d.data().questionId)));
    });

    return () => {
      unsubQuestions();
      unsubAnswers();
      unsubSkips();
    };
  }, [group.id, user?.uid]);

  const handleLeave = async () => {
    if (!user) return;
    if (group.adminUid === user.uid) {
      toast.error(t("Admins cannot leave. Delete the group instead."));
      return;
    }

    try {
      await updateDoc(doc(db, 'groups', group.id), {
        members: arrayRemove(user.uid)
      });
      toast.success(t("Left group"));
      onBack();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}`);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      const batch = writeBatch(db);
      
      // Delete all questions in the group
      const qSnapshot = await getDocs(query(collection(db, 'questions'), where('groupId', '==', group.id)));
      qSnapshot.docs.forEach(d => batch.delete(d.ref));
      
      // Delete the group itself
      batch.delete(doc(db, 'groups', group.id));
      
      await batch.commit();
      toast.success(t("Group deleted"));
      onBack();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `groups/${group.id}`);
    }
  };

  const copyInviteCode = () => {
    navigator.clipboard.writeText(group.inviteCode);
    toast.success(t("Invite code copied!"));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-400 hover:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex gap-2">
          {group.adminUid === user?.uid ? (
            <button onClick={() => setShowDeleteConfirm(true)} className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors">
              <Trash2 className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={handleLeave} className="p-2 text-zinc-500 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-xs bg-zinc-900 border border-white/10 rounded-[2rem] p-8 text-center space-y-6"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold">{t("Delete Group?")}</h3>
                <p className="text-zinc-500 text-sm">
                  {t("This will permanently delete \"")}{group.name}{t("\" and all its questions.")}
                </p>
              </div>
              <div className="space-y-3">
                <Button onClick={handleDelete} className="w-full bg-red-500 hover:bg-red-400 text-white">
                  {t("Delete Group")}
                </Button>
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="w-full py-3 text-sm font-bold text-zinc-500 hover:text-zinc-300"
                >
                  {t("Cancel")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tighter">{group.name}</h2>
          {group.description && <p className="text-zinc-500 text-sm">{group.description}</p>}
        </div>

        <div className="flex gap-2">
          <div className="flex-1 bg-zinc-900/50 border border-white/5 rounded-2xl p-4 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">{t("Invite Code")}</span>
              <p className="font-mono font-bold text-lg tracking-wider">{group.inviteCode}</p>
            </div>
            <button onClick={copyInviteCode} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-zinc-400">
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <div className={cn(
            "bg-zinc-900/50 border rounded-2xl p-4 flex flex-col justify-center items-center min-w-[80px]",
            group.memberCount < 5 ? "border-amber-500/20" : "border-white/5"
          )}>
            <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">{t("Members")}</span>
            <p className="font-bold text-lg">{group.memberCount}</p>
          </div>
        </div>

        {group.memberCount < 5 && (
          <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-500 uppercase tracking-widest">{t("Low Member Count")}</p>
              <p className="text-[10px] text-amber-500/60 leading-relaxed">
                {t("Groups need at least 5 members to reveal detailed insights. Invite more people to unlock demographics!")}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex p-1 bg-zinc-900 rounded-2xl border border-white/5">
        <button
          onClick={() => setActiveTab('feed')}
          className={cn(
            "flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
            activeTab === 'feed' ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          {t("Feed")}
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={cn(
            "flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
            activeTab === 'members' ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          {t("Members")}
        </button>
      </div>

      {activeTab === 'feed' ? (
        <div className="space-y-4">
          <button 
            onClick={() => setShowCreate(true)}
            className="w-full py-6 border-2 border-dashed border-zinc-800 rounded-3xl text-zinc-500 hover:border-zinc-700 hover:text-zinc-400 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span className="font-bold text-sm uppercase tracking-widest">{t("Ask the Group")}</span>
          </button>

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          ) : questions.length === 0 ? (
            <div className="text-center py-20 text-zinc-500">
              <Plus className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>{t("No questions in this group yet.")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {questions
                .filter(q => revisitMode || (!answeredIds.has(q.id) && !skippedIds.has(q.id)))
                .map(q => (
                  <QuestionCard 
                    key={q.id} 
                    question={q} 
                    revisitMode={revisitMode} 
                    onNext={async () => {
                      if (!user) return;
                      const skipId = `${user.uid}_${q.id}`;
                      await setDoc(doc(db, 'skipped_questions', skipId), {
                        userId: user.uid,
                        questionId: q.id,
                        skippedAt: new Date().toISOString()
                      });
                      toast.info(t("Question skipped"));
                    }}
                  />
                ))}
              
              {!revisitMode && questions.some(q => answeredIds.has(q.id) || skippedIds.has(q.id)) && (
                <button 
                  onClick={() => setRevisitMode(true)}
                  className="w-full py-6 border-2 border-dashed border-zinc-800 rounded-3xl text-zinc-500 hover:border-zinc-700 hover:text-zinc-400 transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-5 h-5" />
                  <span className="font-bold text-sm uppercase tracking-widest">{t("Show Answered & Skipped")}</span>
                </button>
              )}
              
              {revisitMode && (
                <button 
                  onClick={() => setRevisitMode(false)}
                  className="w-full py-4 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
                >
                  {t("Hide Answered & Skipped")}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-zinc-900/30 border border-white/5 rounded-3xl p-10 text-center space-y-4">
          <ShieldCheck className="w-12 h-12 text-zinc-800 mx-auto" />
          <div className="space-y-1">
            <h3 className="font-bold text-lg">{t("Anonymity First")}</h3>
            <p className="text-zinc-500 text-sm">
              {t("We only show the total member count (")}{group.memberCount}{t("). Individual usernames are hidden to ensure everyone feels safe sharing their true pulse.")}
            </p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateQuestionModal 
            onClose={() => setShowCreate(false)} 
            groupId={group.id}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateGroupModal({ onClose, onCreated }: { onClose: () => void, onCreated: (group: Group) => void }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!user) return;
    if (!name.trim()) return toast.error(t("Group name is required"));
    if (name.length > 50) return toast.error(t("Name too long (max 50)"));

    setLoading(true);
    try {
      const inviteCode = generateInviteCode();
      const groupData = {
        name: name.trim(),
        description: description.trim(),
        inviteCode,
        adminUid: user.uid,
        memberCount: 1,
        createdAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'groups'), groupData);
      toast.success(t("Group created!"));
      onCreated({ id: docRef.id, ...groupData } as Group);
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'groups');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
    >
      <motion.div 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="w-full max-w-sm bg-zinc-900 border border-white/10 rounded-[2rem] p-8 space-y-8"
      >
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-400">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold tracking-tighter">{t("Create Group")}</h2>
          <div className="w-10" />
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Group Name")}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. The Inner Circle")} maxLength={50} />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">{t("Description (Optional)")}</label>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("What's this group about?")}
              className="w-full bg-black border border-zinc-800 rounded-2xl px-4 py-4 text-white placeholder:text-zinc-700 focus:outline-none focus:border-white/20 h-24 resize-none"
            />
          </div>
        </div>

        <Button onClick={handleCreate} loading={loading} className="w-full h-14 rounded-2xl font-bold text-lg">
          {t("Create Group")}
        </Button>
      </motion.div>
    </motion.div>
  );
}

function JoinGroupModal({ onClose, onJoined }: { onClose: () => void, onJoined: (group: Group) => void }) {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!user) return;
    if (code.length !== 6) return toast.error(t("Enter a 6-character code"));

    setLoading(true);
    try {
      const q = query(collection(db, 'groups'), where('inviteCode', '==', code.toUpperCase()));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        toast.error(t("Invalid invite code"));
        setLoading(false);
        return;
      }

      const groupDoc = snapshot.docs[0];
      const groupData = groupDoc.data() as Group;

      const alreadyMember = await getDoc(
        doc(db, 'groups', groupDoc.id, 'members', user.uid)
      );
      if (alreadyMember.exists()) {
        toast.error(t("You are already a member"));
        onJoined({ id: groupDoc.id, ...groupData });
        onClose();
        return;
      }

      // Stage proof that we knew the invite code. The rule on this
      // subcollection compares it against the group document server-side; the
      // members write below is refused unless this landed first.
      await setDoc(doc(db, 'groups', groupDoc.id, 'joinRequests', user.uid), {
        code: code.toUpperCase()
      });

      // Membership is its own document. The invite-code proof is enforced on
      // its create; the count update below only has to confirm it exists.
      await setDoc(doc(db, 'groups', groupDoc.id, 'members', user.uid), {
        uid: user.uid,
        joinedAt: new Date().toISOString()
      });

      await updateDoc(groupDoc.ref, {
        memberCount: increment(1)
      });

      toast.success(`Joined ${groupData.name}`);
      onJoined({ id: groupDoc.id, ...groupData, memberCount: groupData.memberCount + 1 });
      onClose();
    } catch (error) {
      // The join is several writes now, so a failure partway must say
      // something specific -- the generic message from handleFirestoreError
      // would not tell the user to check the code.
      toast.error(t("Could not join that group. Check the code and try again."));
      handleFirestoreError(error, OperationType.UPDATE, 'groups');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
    >
      <motion.div 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="w-full max-w-sm bg-zinc-900 border border-white/10 rounded-[2rem] p-8 space-y-8"
      >
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-400">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold tracking-tighter">{t("Join Group")}</h2>
          <div className="w-10" />
        </div>

        <div className="space-y-6">
          <div className="space-y-2 text-center">
            <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">{t("Invite Code")}</label>
            <input 
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t("XXXXXX")}
              maxLength={6}
              className="w-full bg-transparent text-5xl font-mono font-bold text-center tracking-[0.5em] focus:outline-none placeholder:text-zinc-800"
            />
          </div>
        </div>

        <Button onClick={handleJoin} loading={loading} className="w-full h-14 rounded-2xl font-bold text-lg">
          {t("Join Group")}
        </Button>
      </motion.div>
    </motion.div>
  );
}

function MyQuestionsView() {
  const { user } = useAuth();
  const [askedQuestions, setAskedQuestions] = useState<Question[]>([]);
  const [answeredQuestions, setAnsweredQuestions] = useState<Question[]>([]);
  const [skippedQuestions, setSkippedQuestions] = useState<Question[]>([]);
  const [activeTab, setActiveTab] = useState<'asked' | 'answered' | 'skipped'>('asked');
  const [unlockedAnswered, setUnlockedAnswered] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch asked questions
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'questions'),
      where('authorUid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (s) => {
      setAskedQuestions(s.docs.map(d => ({ id: d.id, ...d.data() } as Question)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'questions');
      setLoading(false);
    });
  }, [user]);

  // Fetch answered questions
  useEffect(() => {
    if (!user || !unlockedAnswered) return;

    const fetchAnswered = async () => {
      try {
        const q = query(
          collection(db, 'user_answers'),
          where('userId', '==', user.uid)
        );
        
        const snapshot = await getDocs(q);
        const questionIds = snapshot.docs.map(doc => doc.data().questionId as string);
        
        if (questionIds.length === 0) {
          setAnsweredQuestions([]);
          return;
        }

        // Fetch questions in chunks of 10 (Firestore 'in' limit)
        const chunks = [];
        for (let i = 0; i < questionIds.length; i += 10) {
          chunks.push(questionIds.slice(i, i + 10));
        }

        const allQuestions: Question[] = [];
        for (const chunk of chunks) {
          const questionsQ = query(
            collection(db, 'questions'),
            where('__name__', 'in', chunk)
          );
          const qSnapshot = await getDocs(questionsQ);
          allQuestions.push(...qSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question)));
        }

        // Sort by original answered order
        allQuestions.sort((a, b) => questionIds.indexOf(a.id) - questionIds.indexOf(b.id));
        setAnsweredQuestions(allQuestions);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'answered_questions');
      }
    };

    fetchAnswered();
  }, [user, unlockedAnswered]);

  // Fetch skipped questions
  useEffect(() => {
    if (!user || activeTab !== 'skipped') return;

    const fetchSkipped = async () => {
      try {
        const q = query(
          collection(db, 'skipped_questions'),
          where('userId', '==', user.uid),
          orderBy('skippedAt', 'desc')
        );
        
        const snapshot = await getDocs(q);
        const questionIds = snapshot.docs.map(doc => doc.data().questionId as string);
        
        if (questionIds.length === 0) {
          setSkippedQuestions([]);
          return;
        }

        const chunks = [];
        for (let i = 0; i < questionIds.length; i += 10) {
          chunks.push(questionIds.slice(i, i + 10));
        }

        const allQuestions: Question[] = [];
        for (const chunk of chunks) {
          const questionsQ = query(
            collection(db, 'questions'),
            where('__name__', 'in', chunk)
          );
          const qSnapshot = await getDocs(questionsQ);
          allQuestions.push(...qSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question)));
        }

        // Sort by skippedAt order
        allQuestions.sort((a, b) => questionIds.indexOf(a.id) - questionIds.indexOf(b.id));
        setSkippedQuestions(allQuestions);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'skipped_questions');
      }
    };

    fetchSkipped();
  }, [user, activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex p-1 bg-zinc-900 rounded-2xl border border-white/5">
        <button
          onClick={() => setActiveTab('asked')}
          className={cn(
            "flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
            activeTab === 'asked' ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          {t("My Asked")}
        </button>
        <button
          onClick={() => setActiveTab('answered')}
          className={cn(
            "flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
            activeTab === 'answered' ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          {t("Answered")}
        </button>
        <button
          onClick={() => setActiveTab('skipped')}
          className={cn(
            "flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
            activeTab === 'skipped' ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          {t("Skipped")}
        </button>
      </div>

      {activeTab === 'asked' ? (
        <div className="space-y-4">
          {askedQuestions.length === 0 ? (
            <div className="text-center py-20 text-zinc-500">
              <Plus className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>{t("You haven't asked any questions yet.")}</p>
            </div>
          ) : (
            askedQuestions.map(q => (
              <div key={q.id} className="space-y-2">
                {q.status !== 'live' && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl">
                    <AlertCircle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-500">
                      {q.status === 'pending'
                        ? t("Held for review — not visible yet")
                        : q.status === 'duplicate'
                          ? t("Merged with an existing question — answer it below")
                          : t("Rejected — not visible")}
                    </span>
                  </div>
                )}
                {/* Boost is pointless on a question nobody can see. */}
                {q.status === 'duplicate' && (q as Question & { duplicateOf?: string }).duplicateOf
                  ? <OriginalQuestion id={(q as Question & { duplicateOf?: string }).duplicateOf!} />
                  : <QuestionCard question={q} showBoost={q.status === 'live'} revisitMode={true} />}
              </div>
            ))
          )}
        </div>
      ) : activeTab === 'answered' ? (
        <div className="space-y-4">
          {!unlockedAnswered ? (
            <div className="text-center py-20 space-y-6">
              <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center mx-auto border border-white/5">
                <Lock className="w-8 h-8 text-zinc-600" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold">{t("Unlock History")}</h3>
                <p className="text-zinc-500 text-sm max-w-[240px] mx-auto">
                  {t("View all questions you've answered and track your impact.")}
                </p>
              </div>
              
              <button
                onClick={() => setUnlockedAnswered(true)}
                className="bg-white text-black px-8 py-3 rounded-2xl font-bold text-sm hover:scale-105 active:scale-95 transition-all"
              >
                {t("View Answer History")}
              </button>
            </div>
          ) : (
            <>
              {answeredQuestions.length === 0 ? (
                <div className="text-center py-20 text-zinc-500">
                  <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>{t("No answered questions found.")}</p>
                </div>
              ) : (
                answeredQuestions.map(q => <QuestionCard key={q.id} question={q} revisitMode={true} />)
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {skippedQuestions.length === 0 ? (
            <div className="text-center py-20 text-zinc-500">
              <ChevronRight className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>{t("No skipped questions yet.")}</p>
            </div>
          ) : (
            skippedQuestions.map(q => <QuestionCard key={q.id} question={q} revisitMode={true} />)
          )}
        </div>
      )}
    </div>
  );
}

function ProfileView({ answers }: { answers: number | null }) {
  const { user, updateProfile, signOut, redeemReferral, addRecoveryEmail } = useAuth();
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const legacyLogin = !!auth.currentUser?.email?.endsWith('@pulse.app');
  const saveRecoveryEmail = async () => {
    setSavingEmail(true);
    try {
      await addRecoveryEmail(recoveryEmail);
      toast.success(t("Check your inbox and confirm. After that, sign in with this email."));
      setRecoveryEmail('');
    } catch (e: any) {
      toast.error(e.message || t('Could not add the email.'));
    } finally {
      setSavingEmail(false);
    }
  };
  const [verifying, setVerifying] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  const handleVerify = () => {
    setVerifying(true);
    // Simulate verification for now as real phone auth requires complex setup in this environment
    setTimeout(() => {
      updateProfile({ isVerified: true });
      setVerifying(false);
      toast.success(t("Phone verified! You can now post questions."));
    }, 2000);
  };

  const handleRedeem = async () => {
    if (!referralCode.trim()) return;
    setRedeeming(true);
    try {
      await redeemReferral(referralCode);
      setReferralCode('');
    } catch (e) {
      // Error handled in AuthProvider
    } finally {
      setRedeeming(false);
    }
  };

  const copyMyCode = () => {
    if (user?.referralCode) {
      navigator.clipboard.writeText(user.referralCode);
      toast.success(t("Your referral code copied!"));
    }
  };

  const handleBuyCredits = async (amount: number) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        credits: increment(amount)
      });
      toast.success(`Purchased ${amount} credits!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  if (!user) return null;

  const [isAdminUser, setIsAdminUser] = useState(false);
  useEffect(() => {
    if (!user) return;
    // Display only: the rules authorise every approval independently.
    getDoc(doc(db, 'admins', user.uid))
      .then((snap) => setIsAdminUser(snap.exists() || user.uid === HARDCODED_ADMIN_UID))
      .catch(() => setIsAdminUser(user.uid === HARDCODED_ADMIN_UID));
  }, [user?.uid]);

  return (
    <div className="space-y-8">
      {isAdminUser && <ModerationQueue />}
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center border border-white/5">
          <User className="w-12 h-12 text-zinc-600" />
        </div>
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tighter" data-testid="member-label">{memberLabel(user)}</h2>
          {user.memberNumber && user.username && <p className="text-zinc-600 text-xs">@{user.username}</p>}
          {user.asker && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-violet-300">
              <Sparkles className="w-3 h-3" /> {t("Asker")}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
      <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-1">
        <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">{t("Credits")}</span>
        <div className="flex items-center justify-between">
          <p className="text-3xl font-bold">{user.credits}</p>
          {/* The simulated store is gone: credits can only be earned in the app
              until real in-app purchases exist (the rules refuse anything else). */}
        </div>
      </div>

      {showStore && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900/50 border border-indigo-500/20 rounded-3xl p-6 space-y-6"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-bold">{t("Pulse Store")}</h3>
            <button onClick={() => setShowStore(false)} className="text-zinc-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">{t("Development Mode")}</p>
              <p className="text-[10px] text-amber-500/60 leading-relaxed">
                {t("Payments are simulated. No real money will be charged during this preview.")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <StoreItem 
              credits={100} 
              price="$0.99" 
              onBuy={() => handleBuyCredits(100)} 
            />
            <StoreItem 
              credits={500} 
              price="$3.99" 
              onBuy={() => handleBuyCredits(500)} 
              popular 
            />
            <StoreItem 
              credits={1500} 
              price="$9.99" 
              onBuy={() => handleBuyCredits(1500)} 
            />
          </div>
        </motion.div>
      )}
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-1">
          <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">{t("Status")}</span>
          <div className="flex items-center gap-2">
            {user.isVerified ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm font-bold text-green-500">{t("Verified")}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-yellow-500" />
                <span className="text-sm font-bold text-yellow-500">{t("Unverified")}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {!user.isVerified && (
        <div className="bg-zinc-900/50 border border-yellow-500/20 rounded-3xl p-6 space-y-4">
          <div className="space-y-1">
            <h3 className="font-bold">{t("Unlock Posting")}</h3>
            <p className="text-sm text-zinc-500">{t("Verify your phone number to post questions and earn more credits.")}</p>
          </div>
          <Button onClick={handleVerify} loading={verifying} className="w-full bg-yellow-500 text-black hover:bg-yellow-400">
            {t("Verify Phone Number")}
          </Button>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 ml-1">{t("Your invite link")}</h3>
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-4" data-testid="invite-section">
          {user.memberNumber && user.referralCode ? (
            <>
              <p className="text-sm text-zinc-400">{t("Pulse is invite-only. Share your link anywhere: everyone who joins with it gets in, and you both get +15 credits.")}</p>
              <p className="font-mono text-xs break-all bg-black/40 border border-white/5 rounded-xl p-3" data-testid="invite-link">{inviteUrl(user.referralCode)}</p>
              <div className="flex gap-2">
                <Button className="flex-1 h-11 text-sm" onClick={async () => {
                  const r = await shareLink(t("Join me on Pulse: anonymous questions, honest answers."), inviteUrl(user.referralCode!));
                  if (r === 'copied') toast.success(t("Invite link copied!"));
                  if (r !== 'cancelled') track(user.uid, 'shares');
                }}>
                  <Share2 className="w-4 h-4" /> {t("Share")}
                </Button>
                <a href={whatsappUrl(t("Join me on Pulse: anonymous questions, honest answers."), inviteUrl(user.referralCode))} target="_blank" rel="noreferrer"
                  onClick={() => track(user.uid, 'shares')}
                  className="flex-1 h-11 text-sm rounded-xl border border-green-500/30 text-green-400 flex items-center justify-center gap-2 hover:bg-green-500/10">
                  <MessageCircle className="w-4 h-4" /> WhatsApp
                </a>
                <button onClick={() => { navigator.clipboard?.writeText(inviteUrl(user.referralCode!)); toast.success(t("Invite link copied!")); }}
                  className="p-3 hover:bg-white/5 rounded-xl border border-white/5 text-zinc-400" aria-label={t("Copy")}>
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-start gap-3" data-testid="invite-locked">
              <Lock className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
              <div className="space-y-2 flex-1">
                <p className="text-sm font-bold">{t("Answer")} {Math.max(0, UNLOCK_ANSWERS - (answers ?? 0))} {t("more questions to get your member number and invite link.")}</p>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-white" style={{ width: `${Math.min(100, ((answers ?? 0) / UNLOCK_ANSWERS) * 100)}%` }} />
                </div>
              </div>
            </div>
          )}

          {!user.referredBy ? (
            <div className="space-y-3 pt-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">{t("Have a code? Redeem for +15 credits")}</p>
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder={t("ENTER CODE")}
                  className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:border-white/20"
                />
                <button 
                  onClick={handleRedeem}
                  disabled={redeeming || !referralCode.trim()}
                  className="px-4 py-3 bg-white text-black rounded-xl font-bold text-xs disabled:opacity-50"
                >
                  {redeeming ? '...' : t("Redeem")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase tracking-widest bg-black/40 p-3 rounded-xl border border-white/5">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
              <span>{t("Referral code redeemed")}</span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 ml-1">{t("Demographics")}</h3>
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-4">
          <ProfileStat label={t("Age Range")} value={user.demographics.ageRange || t("Not set")} />
          <ProfileStat label={t("Gender")} value={user.demographics.gender || t("Not set")} />
          <ProfileStat label={t("Country")} value={user.demographics.country || t("Not set")} />
        </div>
      </div>

      {legacyLogin && (
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-3" data-testid="recovery-email">
          <h3 className="font-bold">{t("Add a recovery email")}</h3>
          <p className="text-sm text-zinc-500">{t("You sign in with a username, so a forgotten password can't be reset. Add your email to fix that. It is never shown to anyone.")}</p>
          <div className="flex gap-2">
            <Input value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} placeholder={t("you@example.com")} type="email" />
            <Button onClick={saveRecoveryEmail} loading={savingEmail} disabled={!recoveryEmail.includes('@')}>{t("Save")}</Button>
          </div>
        </div>
      )}

      <LanguageToggle />

      <Button variant="ghost" className="w-full text-red-500 hover:text-red-400 hover:bg-red-500/10" onClick={signOut}>
        {t("Sign Out")}
      </Button>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  );
}

function StoreItem({ credits, price, onBuy, popular }: { credits: number, price: string, onBuy: () => void, popular?: boolean }) {
  return (
    <button 
      onClick={onBuy}
      className={cn(
        "flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.98]",
        popular ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-black/40 border-white/5 hover:border-white/10'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center",
          popular ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-400'
        )}>
          <Coins className="w-5 h-5" />
        </div>
        <div className="text-left">
          <p className="font-bold">{credits} {t("Credits")}</p>
          {popular && <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">{t("Most Popular")}</span>}
        </div>
      </div>
      <div className="text-right">
        <p className="font-bold text-lg">{price}</p>
      </div>
    </button>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <PulseApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}

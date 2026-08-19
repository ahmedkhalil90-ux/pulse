import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { 
  onAuthStateChanged, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  increment,
  onSnapshot, 
  collection, 
  query, 
  where, 
  getDocs, 
  deleteDoc, 
  writeBatch 
} from 'firebase/firestore';
import { toast } from 'sonner';
import { UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firebase';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  signUp: (username: string, password: string, demographics: UserProfile['demographics']) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  redeemReferral: (code: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous profile listener if it exists
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (firebaseUser) {
        try {
          // Use a timeout for the initial profile fetch to prevent infinite loading
          const profilePromise = getDoc(doc(db, 'users', firebaseUser.uid));
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Profile fetch timeout')), 5000));
          
          const userDoc = await Promise.race([profilePromise, timeoutPromise]) as any;
          
          if (userDoc.exists()) {
            const profile = { uid: firebaseUser.uid, ...userDoc.data() } as UserProfile;
            
            // Set initial user state immediately for better UX
            setUser(profile);
            
            // Listen for real-time updates to user profile (credits, etc.)
            unsubProfile = onSnapshot(doc(db, 'users', firebaseUser.uid), (doc) => {
              if (doc.exists()) {
                setUser({ uid: firebaseUser.uid, ...doc.data() } as UserProfile);
              }
            }, (error) => {
              console.error('Profile snapshot error:', error);
            });

            // Daily Bonus Logic
            const today = new Date().toISOString().split('T')[0];
            const lastLoginDate = profile.lastLogin?.split('T')[0];

            if (lastLoginDate !== today) {
              try {
                await updateDoc(doc(db, 'users', firebaseUser.uid), {
                  credits: increment(3),
                  lastLogin: today
                });
                
                setTimeout(() => {
                  toast.success("🎉 Daily bonus! +3 credits");
                }, 2000);
              } catch (err) {
                console.error('Daily bonus award failed:', err);
              }
            }

            // Backfill referralCode for existing users
            if (!profile.referralCode) {
              try {
                const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                await updateDoc(doc(db, 'users', firebaseUser.uid), {
                  referralCode: newCode
                });
              } catch (err) {
                console.error('Failed to backfill referralCode:', err);
              }
            }

            // Migration check: See if there are any orphaned profiles with this username
            try {
              const q = query(collection(db, 'users'), where('username', '==', profile.username));
              const snapshot = await getDocs(q);
              
              if (snapshot.docs.length > 1) {
                const batch = writeBatch(db);
                let migrated = false;
                
                for (const oldDoc of snapshot.docs) {
                  const oldUid = oldDoc.id;
                  if (oldUid !== firebaseUser.uid) {
                    console.log('Found orphaned profile to migrate:', oldUid);
                    migrated = true;
                    
                    // Migrate user_answers
                    const answersQ = query(collection(db, 'user_answers'), where('userId', '==', oldUid));
                    const answersSnapshot = await getDocs(answersQ);
                    for (const answerDoc of answersSnapshot.docs) {
                      const data = answerDoc.data();
                      const newAnswerId = `${firebaseUser.uid}_${data.questionId}`;
                      batch.set(doc(db, 'user_answers', newAnswerId), {
                        ...data,
                        userId: firebaseUser.uid
                      });
                      batch.delete(answerDoc.ref);
                    }
                    
                    // Migrate questions
                    const questionsQ = query(collection(db, 'questions'), where('authorUid', '==', oldUid));
                    const questionsSnapshot = await getDocs(questionsQ);
                    for (const questionDoc of questionsSnapshot.docs) {
                      batch.update(questionDoc.ref, { authorUid: firebaseUser.uid });
                    }
                    
                    // Delete old user profile
                    batch.delete(doc(db, 'users', oldUid));
                  }
                }
                
                if (migrated) {
                  await batch.commit();
                  console.log('Migration complete for existing user');
                }
              }
            } catch (migError: any) {
              console.error('Migration error (non-fatal):', migError);
              // Don't throw here, just log it. We want the user to be able to use the app.
            }
          } else {
            setUser(null);
          }
        } catch (error) {
          console.error('Auth check error:', error);
          setUser(null);
        } finally {
          setLoading(false);
        }
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const signUp = async (username: string, password: string, demographics: UserProfile['demographics']) => {
    try {
      // Use a dummy email for username/password auth
      const email = `${username.toLowerCase()}@pulse.app`;
      
      // 1. Check if this username is already registered with a password
      // We do this by trying to create the user. If it fails with 'email-already-in-use', 
      // it means someone already set a password for this handle.
      let firebaseUser;
      try {
        firebaseUser = (await createUserWithEmailAndPassword(auth, email, password)).user;
      } catch (authError: any) {
        if (authError.code === 'auth/email-already-in-use') {
          throw new Error('This username is already protected with a password. Please Sign In instead.');
        }
        if (authError.code === 'auth/weak-password') {
          throw new Error('Password must be at least 6 characters.');
        }
        throw authError;
      }

      // 2. Check if a profile with this username already exists (e.g. from your previous anonymous session)
      const q = query(collection(db, 'users'), where('username', '==', username));
      const snapshot = await getDocs(q);
      
      let oldUid: string | null = null;
      let existingData: any = {};
      
      if (!snapshot.empty) {
        const oldDoc = snapshot.docs[0];
        oldUid = oldDoc.id;
        if (oldUid !== firebaseUser.uid) {
          existingData = oldDoc.data();
        } else {
          oldUid = null; // Already the same user
        }
      }

      // 3. Create/Update the new profile FIRST
      const today = new Date().toISOString().split('T')[0];
      
      // Calculate initial credits: 10 base + 3 daily bonus
      // If migrating from an existing account, add their credits too
      const baseCredits = 10;
      const dailyBonus = 3;
      const existingCredits = existingData.credits !== undefined ? existingData.credits : 0;
      const initialCredits = baseCredits + dailyBonus + existingCredits;

      const profile: UserProfile = {
        uid: firebaseUser.uid,
        username,
        isVerified: existingData.isVerified || false,
        credits: initialCredits,
        demographics: existingData.demographics || demographics,
        lastLogin: today,
        referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      };
      
      await setDoc(doc(db, 'users', firebaseUser.uid), profile);

      // 4. If we have an old account to migrate from
      if (oldUid) {
        console.log('Migrating data from old account:', oldUid);
        const batch = writeBatch(db);
        
        try {
          // Migrate user_answers
          const answersQ = query(collection(db, 'user_answers'), where('userId', '==', oldUid));
          const answersSnapshot = await getDocs(answersQ);
          for (const answerDoc of answersSnapshot.docs) {
            const data = answerDoc.data();
            const newAnswerId = `${firebaseUser.uid}_${data.questionId}`;
            batch.set(doc(db, 'user_answers', newAnswerId), {
              ...data,
              userId: firebaseUser.uid
            });
            batch.delete(answerDoc.ref);
          }
          
          // Migrate questions
          const questionsQ = query(collection(db, 'questions'), where('authorUid', '==', oldUid));
          const questionsSnapshot = await getDocs(questionsQ);
          for (const questionDoc of questionsSnapshot.docs) {
            batch.update(questionDoc.ref, { authorUid: firebaseUser.uid });
          }
          
          // Delete old user profile
          batch.delete(doc(db, 'users', oldUid));
          
          await batch.commit();
        } catch (migError: any) {
          console.error('Migration error during signup:', migError);
          // Log more details if it's a permission error
          if (migError.message?.includes('permissions')) {
            handleFirestoreError(migError, OperationType.WRITE, `migration_from_${oldUid}`);
          }
        }
      }
      
      setUser(profile);
    } catch (error: any) {
      throw error;
    }
  };

  const signIn = async (username: string, password: string) => {
    try {
      const email = `${username.toLowerCase()}@pulse.app`;
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        throw new Error('Invalid username or password.');
      }
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return;
    try {
      // Use updateDoc to avoid overwriting unrelated fields like credits
      await updateDoc(doc(db, 'users', user.uid), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const redeemReferral = async (code: string) => {
    if (!user) return;
    if (user.referredBy) throw new Error('You have already redeemed a referral code.');
    if (user.referralCode === code.toUpperCase()) throw new Error('You cannot use your own referral code.');

    try {
      const q = query(collection(db, 'users'), where('referralCode', '==', code.toUpperCase()));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) throw new Error('Invalid referral code.');
      
      const referrerDoc = snapshot.docs[0];
      const referrerUid = referrerDoc.id;

      const batch = writeBatch(db);
      
      // Award credits to current user
      batch.update(doc(db, 'users', user.uid), {
        credits: increment(15),
        referredBy: referrerUid
      });

      // Award credits to referrer
      batch.update(doc(db, 'users', referrerUid), {
        credits: increment(15)
      });

      await batch.commit();
      toast.success('Referral code redeemed! +15 Credits awarded to both of you.');
    } catch (error: any) {
      toast.error(error.message || 'Failed to redeem referral code.');
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut, updateProfile, redeemReferral }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

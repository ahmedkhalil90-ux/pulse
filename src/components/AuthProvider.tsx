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
  deleteField, 
  writeBatch 
} from 'firebase/firestore';
import { toast } from 'sonner';
import { UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import { awardDailyBonus, awardReferral } from '../lib/credits';

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

            // Daily Bonus Logic. The lastLogin check runs inside the
            // transaction rather than against this snapshot, so two tabs
            // opening at once cannot both see a stale value and both award it.
            try {
              const awarded = await awardDailyBonus(db, firebaseUser.uid);
              if (awarded) {
                setTimeout(() => {
                  toast.success("🎉 Daily bonus! +3 credits");
                }, 2000);
              }
            } catch (err) {
              console.error('Daily bonus award failed:', err);
            }

            // Backfill referralCode for existing users
            if (!profile.referralCode) {
              try {
                const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                // Profile field first, because the mapping rule checks the
                // code against it -- then the mapping. If the mapping write
                // fails we clear the field again, so the `!profile.referralCode`
                // guard re-runs next session instead of leaving the user
                // holding a code nobody can redeem.
                await updateDoc(doc(db, 'users', firebaseUser.uid), {
                  referralCode: newCode
                });
                try {
                  await setDoc(doc(db, 'referralCodes', newCode), {
                    uid: firebaseUser.uid,
                  });
                } catch (mapErr) {
                  await updateDoc(doc(db, 'users', firebaseUser.uid), {
                    referralCode: deleteField()
                  });
                  throw mapErr;
                }
              } catch (err) {
                console.error('Failed to backfill referralCode:', err);
              }
            }

            // Migration check: See if there are any orphaned profiles with this username
            try {
              // By document ID: `users` is no longer listable. This finds the
              // one profile the username currently maps to, which is the
              // orphan if it is not already us.
              const usernameKey = profile.username.toLowerCase();
              const mappingSnap = await getDoc(doc(db, 'usernames', usernameKey));
              const mappedUid = mappingSnap.exists()
                ? (mappingSnap.data().uid as string)
                : null;

              // Self-heal: accounts that predate the mapping have none, and
              // nothing else would ever create one. The caller's own token is
              // the proof, so this is always permitted.
              if (!mappingSnap.exists()) {
                try {
                  await setDoc(doc(db, 'usernames', usernameKey), {
                    uid: firebaseUser.uid,
                  });
                } catch (healErr) {
                  console.error('Could not backfill username mapping:', healErr);
                }
              }

              // A mapping pointing at a profile that no longer exists would
              // wedge the sweep forever: the batch below deletes users/{oldUid},
              // isMigrating() requires that document to exist, and the whole
              // atomic batch -- including the re-point that would repair the
              // mapping -- fails with it.
              const orphanExists =
                mappedUid && mappedUid !== firebaseUser.uid
                  ? (await getDoc(doc(db, 'users', mappedUid))).exists()
                  : false;

              if (mappedUid && mappedUid !== firebaseUser.uid && !orphanExists) {
                try {
                  await setDoc(doc(db, 'usernames', usernameKey), {
                    uid: firebaseUser.uid,
                  });
                } catch (repointErr) {
                  console.error('Could not re-point a stale mapping:', repointErr);
                }
              }

              if (mappedUid && mappedUid !== firebaseUser.uid && orphanExists) {
                const batch = writeBatch(db);
                let migrated = false;

                {
                  const oldUid = mappedUid;
                  {
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
                  // Re-point the mapping at us, or the next sign-in would try
                  // to migrate the profile we just deleted.
                  batch.set(doc(db, 'usernames', usernameKey), {
                    uid: firebaseUser.uid,
                  });
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

      // 2. Check if a profile with this username already exists (e.g. from your
      // previous anonymous session).
      //
      // Looked up by document ID rather than by scanning `users`, which is no
      // longer listable. Uniqueness is not enforced here and never was --
      // createUserWithEmailAndPassword above already rejected a duplicate.
      const usernameKey = username.toLowerCase();
      const mappingSnap = await getDoc(doc(db, 'usernames', usernameKey));

      let oldUid: string | null = null;
      let existingData: any = {};

      if (mappingSnap.exists()) {
        const mappedUid = mappingSnap.data().uid as string;
        if (mappedUid && mappedUid !== firebaseUser.uid) {
          const oldProfile = await getDoc(doc(db, 'users', mappedUid));
          if (oldProfile.exists()) {
            oldUid = mappedUid;
            existingData = oldProfile.data();
          }
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

      // The referral mapping is checked against the profile just written, so
      // it has to follow it. Non-fatal: a code collision would otherwise
      // reject signUp after the auth account and profile already exist,
      // leaving the user unable to sign up OR sign in.
      try {
        await setDoc(doc(db, 'referralCodes', profile.referralCode), {
          uid: firebaseUser.uid,
        });
      } catch (codeErr) {
        console.error('Referral code mapping not claimed (code may collide):', codeErr);
      }

      // NOTE: the username mapping is claimed AFTER migration, further down.
      // Claiming it here would make migration single-shot -- the next sign-in
      // would see the mapping already pointing at us and never retry.

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

      // Claim the username mapping last. If migration above failed, the
      // mapping still points at the orphan, so the next sign-in finds it and
      // tries again -- which is what the old username scan gave us for free.
      try {
        await setDoc(doc(db, 'usernames', usernameKey), { uid: firebaseUser.uid });
      } catch (mapErr) {
        console.error('Username mapping not claimed; sign-in will retry:', mapErr);
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
      // By document ID: `users` is no longer listable.
      const codeSnap = await getDoc(doc(db, 'referralCodes', code.toUpperCase()));

      if (!codeSnap.exists()) throw new Error('Invalid referral code.');

      const referrerUid = codeSnap.data().uid as string;
      if (!referrerUid) throw new Error('Invalid referral code.');

      await awardReferral(db, user.uid, referrerUid);
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

import { t } from '../lib/i18n';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { 
  onAuthStateChanged, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  verifyBeforeUpdateEmail,
  deleteUser,
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
  serverTimestamp,
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
  signUp: (email: string, password: string, demographics: UserProfile['demographics'], inviteCode: string) => Promise<void>;
  /** Email, or the username of an account made before email sign-in. */
  signIn: (emailOrUsername: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Legacy username accounts: attach a real email so the password can be reset. */
  addRecoveryEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  redeemReferral: (code: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const uid = user?.uid ?? null;

  // Live profile listener, keyed on uid. Previously it was only attached when
  // a profile already existed at sign-in, so a new account (profile written
  // during signup, after the auth callback) never saw its credit balance
  // change until the app was reloaded. Found by the player bots.
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) setUser({ uid, ...snap.data() } as UserProfile);
    }, (error) => {
      console.error('Profile snapshot error:', error);
    });
  }, [uid]);
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
            
            // Real-time profile updates (credits etc.) are handled by the
            // uid-keyed effect below, so they also cover brand-new accounts
            // whose profile is written after this handler has already run.

            // Daily Bonus Logic. The lastLogin check runs inside the
            // transaction rather than against this snapshot, so two tabs
            // opening at once cannot both see a stale value and both award it.
            try {
              const awarded = await awardDailyBonus(db, firebaseUser.uid);
              if (awarded) {
                setTimeout(() => {
                  toast.success(t("🎉 Daily bonus! +3 credits"));
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
              // Email accounts have no username and nothing to migrate.
              if (!profile.username) throw Object.assign(new Error('no username'), { skip: true });
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
              if (!migError?.skip) console.error('Migration error (non-fatal):', migError);
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

  /**
   * Invite-only sign-up with a real email address, so the password can be
   * reset. The rules refuse the profile unless `inviteCode` belongs to a
   * member who has unlocked inviting. If they refuse, the just-created auth
   * account is deleted again, so the person is not left with a login that
   * leads nowhere.
   */
  const signUp = async (email: string, password: string, demographics: UserProfile['demographics'], inviteCode: string) => {
    const address = email.trim().toLowerCase();
    if (address.endsWith('@pulse.app')) throw new Error(t('Please use your own email address.'));
    let firebaseUser;
    try {
      firebaseUser = (await createUserWithEmailAndPassword(auth, address, password)).user;
    } catch (authError: any) {
      if (authError.code === 'auth/email-already-in-use') throw new Error(t('This email already has an account. Please sign in.'));
      if (authError.code === 'auth/invalid-email') throw new Error(t('Please enter a valid email address.'));
      if (authError.code === 'auth/weak-password') throw new Error(t('Password must be at least 6 characters'));
      throw authError;
    }

    const profile = {
      uid: firebaseUser.uid,
      isVerified: false,
      credits: 13, // 10 to start + today's daily bonus
      demographics,
      lastLogin: new Date().toISOString().split('T')[0],
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      invitedWith: inviteCode.trim().toUpperCase(),
      createdAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'users', firebaseUser.uid), profile);
    } catch (e: any) {
      await deleteUser(firebaseUser).catch(() => {});
      if (e?.code === 'permission-denied') {
        throw Object.assign(new Error(t("This invite link isn't valid any more. Ask your friend for a new one, or join the waitlist.")), { code: 'invalid-invite' });
      }
      throw e;
    }

    // Non-fatal: a code collision must not undo a finished sign-up.
    try {
      await setDoc(doc(db, 'referralCodes', profile.referralCode), { uid: firebaseUser.uid });
    } catch (codeErr) {
      console.error('Referral code mapping not claimed (code may collide):', codeErr);
    }
    // The rules needed the invite code to create the profile; it is not kept
    // there, because profiles are readable by any member and the code leads
    // to the inviter. The private referrals record keeps it instead.
    await updateDoc(doc(db, 'users', firebaseUser.uid), { invitedWith: deleteField() }).catch(() => {});
    const { invitedWith: _code, createdAt: _at, ...visible } = profile;
    setUser(visible as unknown as UserProfile);
  };

  const resetPassword = async (email: string) => {
    const address = email.trim().toLowerCase();
    if (!address.includes('@') || address.endsWith('@pulse.app')) {
      throw new Error(t('Enter the email address on your account. Username accounts can add one in Profile once signed in.'));
    }
    try {
      await sendPasswordResetEmail(auth, address);
    } catch (e: any) {
      if (e.code === 'auth/invalid-email') throw new Error(t('Please enter a valid email address.'));
      // auth/user-not-found is not revealed, so nobody can probe who has an account.
      if (e.code !== 'auth/user-not-found') throw e;
    }
  };

  const addRecoveryEmail = async (email: string) => {
    const address = email.trim().toLowerCase();
    if (!auth.currentUser) return;
    if (!address.includes('@') || address.endsWith('@pulse.app')) throw new Error(t('Please enter a valid email address.'));
    try {
      await verifyBeforeUpdateEmail(auth.currentUser, address);
    } catch (e: any) {
      if (e.code === 'auth/requires-recent-login') throw new Error(t('For your security, sign out and back in, then try again.'));
      if (e.code === 'auth/email-already-in-use') throw new Error(t('That email already has an account.'));
      throw e;
    }
  };

  const signIn = async (emailOrUsername: string, password: string) => {
    try {
      const id = emailOrUsername.trim().toLowerCase();
      const email = id.includes('@') ? id : `${id}@pulse.app`;
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        throw new Error(t('Wrong email or password.'));
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

      await awardReferral(db, user.uid, referrerUid, code);
      toast.success(t("Referral code redeemed! +15 Credits for you, and your friend gets theirs shortly."));
    } catch (error: any) {
      toast.error(error.message || 'Failed to redeem referral code.');
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut, updateProfile, redeemReferral, resetPassword, addRecoveryEmail }}>
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

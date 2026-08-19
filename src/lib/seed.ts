import { collection, getDocs, addDoc, query, limit, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import seedData from '../pulse_seed_questions.json';

export async function seedDatabase() {
  try {
    // Check if questions already exist (only check public ones to avoid permission issues)
    const q = query(
      collection(db, 'questions'), 
      where('isPublic', '==', true),
      limit(1)
    );
    let snapshot;
    try {
      snapshot = await getDocs(q);
    } catch (error) {
      console.error('Seed check failed (non-fatal):', error);
      return;
    }
    
    if (!snapshot.empty) {
      console.log('Database already seeded.');
      return;
    }

    console.log('Seeding database with Pulse Originals...');
    
    const SYSTEM_UID = 'pulse_originals_system';
    const questions = seedData.questions;

    // Seed in batches or one by one (Firestore handles small batches well)
    for (const qData of questions) {
      try {
        await addDoc(collection(db, 'questions'), {
          text: qData.question,
          options: [qData.option_a, qData.option_b],
          category: qData.category,
          authorUid: SYSTEM_UID,
          isPublic: true,
          createdAt: new Date().toISOString(),
          status: 'live',
          flags: 0
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'questions');
      }
    }

    console.log('Seeding complete!');
  } catch (error) {
    console.error('Error seeding database:', error);
  }
}

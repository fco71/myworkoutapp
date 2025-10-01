/**
 * Cleanup script to remove duplicate workout sessions from Firestore
 * Run this to clean up multiple "Manual" entries with the same sessionTypes on the same date
 */

import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  deleteDoc, 
  doc,
  query,
  where 
} from 'firebase/firestore';

// Firebase config from your project
const firebaseConfig = {
  apiKey: "AIzaSyB7OR5aBzZ8N4d7BaB_HlZoFfWGegG7Fvg",
  authDomain: "fcoworkout.firebaseapp.com",
  projectId: "fcoworkout",
  storageBucket: "fcoworkout.firebasestorage.app",
  messagingSenderId: "939615720328",
  appId: "1:939615720328:web:d60687e4e617d0d3b5203d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cleanupDuplicateSessions(userId) {
  console.log(`Starting cleanup for user: ${userId}`);
  
  try {
    // Get all sessions for the user
    const sessionsRef = collection(db, 'users', userId, 'sessions');
    const snapshot = await getDocs(sessionsRef);
    
    const sessions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log(`Found ${sessions.length} total sessions`);
    
    // Group by date + sessionTypes to find duplicates
    const groups = {};
    sessions.forEach(session => {
      const key = `${session.dateISO}:${JSON.stringify((session.sessionTypes || []).sort())}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(session);
    });
    
    let duplicatesRemoved = 0;
    
    // Process each group
    for (const [key, groupSessions] of Object.entries(groups)) {
      if (groupSessions.length > 1) {
        console.log(`Found ${groupSessions.length} duplicates for key: ${key}`);
        
        // Sort to keep the best one (most exercises, or most recent)
        groupSessions.sort((a, b) => {
          const aScore = (a.exercises?.length || 0) * 1000 + (a.completedAt || 0);
          const bScore = (b.exercises?.length || 0) * 1000 + (b.completedAt || 0);
          return bScore - aScore;
        });
        
        // Keep the first (best) one, delete the rest
        const [keep, ...remove] = groupSessions;
        console.log(`Keeping session ${keep.id} (${keep.sessionName}) with ${keep.exercises?.length || 0} exercises`);
        
        for (const session of remove) {
          console.log(`Removing duplicate session ${session.id} (${session.sessionName})`);
          try {
            await deleteDoc(doc(db, 'users', userId, 'sessions', session.id));
            duplicatesRemoved++;
          } catch (error) {
            console.error(`Failed to delete session ${session.id}:`, error);
          }
        }
      }
    }
    
    console.log(`Cleanup complete! Removed ${duplicatesRemoved} duplicate sessions.`);
    
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// Usage: node cleanup-duplicate-sessions.js USER_ID
const userId = process.argv[2];

if (!userId) {
  console.error('Please provide a user ID as an argument');
  console.error('Usage: node cleanup-duplicate-sessions.js USER_ID');
  process.exit(1);
}

cleanupDuplicateSessions(userId)
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
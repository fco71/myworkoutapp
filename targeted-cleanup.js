// Targeted cleanup for specific corrupted sessions
// Run this in your browser console on http://localhost:8001
// PRESERVES all previous week benchmark data

async function targetedCleanup() {
  // Try to access Firebase through React DevTools or window
  let auth, db, collection, getDocs, deleteDoc, doc;
  
  try {
    // Try to get Firebase from the React component via DevTools
    const reactRoot = document.querySelector('#root')?._reactInternalInstance || 
                     document.querySelector('#root')?._reactInternals ||
                     window.React;
    
    // Import Firebase functions directly
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js');
    const { getFirestore, collection: fbCollection, getDocs: fbGetDocs, deleteDoc: fbDeleteDoc, doc: fbDoc } = 
      await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
    
    // Initialize Firebase if needed
    const firebaseConfig = {
      apiKey: "AIzaSyB7OR5aBzZ8N4d7BaB_HlZoFfWGegG7Fvg",
      authDomain: "fcoworkout.firebaseapp.com",
      projectId: "fcoworkout",
      storageBucket: "fcoworkout.firebasestorage.app",
      messagingSenderId: "939615720328",
      appId: "1:939615720328:web:d60687e4e617d0d3b5203d"
    };
    
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    collection = fbCollection;
    getDocs = fbGetDocs;
    deleteDoc = fbDeleteDoc;
    doc = fbDoc;
    
  } catch (error) {
    console.error('❌ Could not load Firebase:', error);
    console.log('Alternative: Copy this entire script and paste it into your browser console on the History tab');
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error('❌ Not signed in. Please sign in to your workout app first.');
    return;
  }
  
  console.log('🔍 Starting targeted cleanup...');
  console.log('⚠️  PRESERVING all previous week benchmark data');
  
  const sessionsRef = collection(db, 'users', uid, 'sessions');
  const snapshot = await getDocs(sessionsRef);
  
  console.log(`Found ${snapshot.docs.length} total sessions`);
  
  let deletedCount = 0;
  
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const date = data.dateISO || new Date(data.completedAt || data.ts || 0).toISOString().split('T')[0];
    const sessionTypes = data.sessionTypes || [];
    
    let shouldDelete = false;
    let reason = '';
    
    // Friday Sept 26 - delete ALL sessions (you did nothing)
    if (date === '2025-09-26') {
      shouldDelete = true;
      reason = 'Friday - you did nothing, removing incorrect bike session';
    }
    
    // Sunday Sept 28 - keep only the LATEST meditation session, delete duplicates
    else if (date === '2025-09-28') {
      const allSept28Sessions = snapshot.docs
        .map(d => ({ id: d.id, data: d.data() }))
        .filter(s => {
          const sDate = s.data.dateISO || new Date(s.data.completedAt || s.data.ts || 0).toISOString().split('T')[0];
          return sDate === '2025-09-28' && (s.data.sessionTypes || []).includes('Meditation');
        })
        .sort((a, b) => (b.data.completedAt || 0) - (a.data.completedAt || 0));
      
      // Keep the most recent one, delete the rest
      if (allSept28Sessions.length > 1 && docSnap.id !== allSept28Sessions[0].id) {
        shouldDelete = true;
        reason = 'Sunday - duplicate meditation session, keeping only the latest';
      }
    }
    
    // Monday Sept 23 - keep only the LATEST meditation session, delete duplicates  
    else if (date === '2025-09-23') {
      const allSept23Sessions = snapshot.docs
        .map(d => ({ id: d.id, data: d.data() }))
        .filter(s => {
          const sDate = s.data.dateISO || new Date(s.data.completedAt || s.data.ts || 0).toISOString().split('T')[0];
          return sDate === '2025-09-23' && (s.data.sessionTypes || []).includes('Meditation');
        })
        .sort((a, b) => (b.data.completedAt || 0) - (a.data.completedAt || 0));
      
      // Keep the most recent one, delete the rest
      if (allSept23Sessions.length > 1 && docSnap.id !== allSept23Sessions[0].id) {
        shouldDelete = true;
        reason = 'Monday - duplicate meditation session, keeping only the latest';
      }
    }
    
    // Today Sept 29 - KEEP (user confirmed Calves/Bike is correct)
    else if (date === '2025-09-29') {
      console.log(`✅ Keeping today's session: ${sessionTypes.join(', ')} (user confirmed correct)`);
    }
    
    if (shouldDelete) {
      console.log(`🗑️  Deleting ${date} session: ${sessionTypes.join(', ')} - ${reason}`);
      try {
        await deleteDoc(doc(db, 'users', uid, 'sessions', docSnap.id));
        deletedCount++;
      } catch (e) {
        console.error(`Failed to delete ${docSnap.id}:`, e);
      }
    } else {
      console.log(`✅ Keeping ${date} session: ${sessionTypes.join(', ')}`);
    }
  }
  
  console.log(`✅ Cleanup complete! Deleted ${deletedCount} corrupted sessions.`);
  console.log('📊 All previous week benchmark data preserved');
  
  alert('Cleanup complete! Your previous week benchmarks are preserved. Refresh History to see clean data.');
}

// Run the cleanup
targetedCleanup();
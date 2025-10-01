// SIMPLE CLEANUP SCRIPT - Copy and paste this into your browser console
// Make sure you're on the History tab of your workout app first!

(async function() {
  console.log('🔍 Looking for Firebase objects in your app...');
  
  // Try to find Firebase objects from your app
  let auth, db, collection, getDocs, deleteDoc, doc;
  
  // Method 1: Try to find them through React Fiber
  try {
    const rootElement = document.querySelector('#root');
    const reactFiber = rootElement._reactInternalFiber || rootElement._reactInternals;
    
    if (reactFiber) {
      // Walk up the fiber tree to find the app component
      let current = reactFiber.child;
      let attempts = 0;
      while (current && attempts < 50) {
        if (current.stateNode && typeof current.stateNode === 'object') {
          const props = current.memoizedProps || current.pendingProps || {};
          const state = current.memoizedState || {};
          
          // Look for Firebase objects in props or state
          if (props.auth || state.auth) {
            auth = props.auth || state.auth;
            console.log('✅ Found auth object');
          }
          if (props.db || state.db) {
            db = props.db || state.db;
            console.log('✅ Found db object');
          }
        }
        current = current.child || current.sibling;
        attempts++;
      }
    }
  } catch (e) {
    console.log('React Fiber method failed, trying global objects...');
  }
  
  // Method 2: Check for global Firebase objects
  if (!auth || !db) {
    if (window.firebase) {
      auth = window.firebase.auth();
      db = window.firebase.firestore();
      console.log('✅ Found Firebase via window.firebase');
    }
  }
  
  // Method 3: Manual guidance
  if (!auth || !db) {
    console.error('❌ Could not find Firebase objects automatically.');
    console.log('');
    console.log('MANUAL STEPS:');
    console.log('1. In your browser console, type: window.appAuth = yourAuthObject');
    console.log('2. Type: window.appDb = yourDbObject');
    console.log('3. Then run this script again');
    console.log('');
    console.log('OR try this simpler approach:');
    console.log('In your WorkoutTrackerApp component, temporarily add:');
    console.log('window.appAuth = auth; window.appDb = db;');
    console.log('Then refresh and run this script');
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error('❌ Not signed in. Please sign in first.');
    return;
  }
  
  console.log('🔍 Starting targeted cleanup...');
  console.log('⚠️  PRESERVING all previous week benchmark data');
  
  // Import Firestore functions
  const { collection: fbCollection, getDocs: fbGetDocs, deleteDoc: fbDeleteDoc, doc: fbDoc } = 
    await import('firebase/firestore');
  
  const sessionsRef = fbCollection(db, 'users', uid, 'sessions');
  const snapshot = await fbGetDocs(sessionsRef);
  
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
        await fbDeleteDoc(fbDoc(db, 'users', uid, 'sessions', docSnap.id));
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
})();
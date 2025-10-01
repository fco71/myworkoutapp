// DIRECT FIREBASE CLEANUP - Copy and paste this into console
// This version imports Firebase functions directly

async function directCleanup() {
  console.log('🔍 Starting direct Firebase cleanup...');
  
  const auth = window.appAuth;
  const db = window.appDb;
  
  if (!auth || !db) {
    console.error('❌ Firebase objects not found.');
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error('❌ Not signed in.');
    return;
  }
  
  console.log('User ID:', uid);
  console.log('⚠️  PRESERVING all previous week benchmark data');
  
  try {
    // Import Firebase functions directly
    const { collection, getDocs, deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
    
    const sessionsRef = collection(db, 'users', uid, 'sessions');
    const snapshot = await getDocs(sessionsRef);
    
    console.log(`Found ${snapshot.docs.length} total sessions`);
    
    let deletedCount = 0;
    const sessionsData = [];
    
    // First, collect all session data for analysis
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const date = data.dateISO || new Date(data.completedAt || data.ts || 0).toISOString().split('T')[0];
      const sessionTypes = data.sessionTypes || [];
      const timestamp = data.completedAt || data.ts || 0;
      
      sessionsData.push({
        id: docSnap.id,
        date,
        sessionTypes,
        timestamp,
        data
      });
    }
    
    // Sort sessions by date and timestamp for better analysis
    sessionsData.sort((a, b) => a.date.localeCompare(b.date) || (b.timestamp - a.timestamp));
    
    console.log('📊 All sessions:');
    sessionsData.forEach(s => {
      console.log(`${s.date}: ${s.sessionTypes.join(', ')} (${new Date(s.timestamp).toLocaleString()})`);
    });
    
    // Now apply deletion logic
    for (const session of sessionsData) {
      let shouldDelete = false;
      let reason = '';
      
      // Friday Sept 26 - delete ALL sessions (you did nothing)
      if (session.date === '2025-09-26') {
        shouldDelete = true;
        reason = 'Friday - you did nothing, removing incorrect session';
      }
      
      // Sunday Sept 28 - keep only the LATEST meditation session
      else if (session.date === '2025-09-28' && session.sessionTypes.includes('Meditation')) {
        const sept28Sessions = sessionsData.filter(s => 
          s.date === '2025-09-28' && s.sessionTypes.includes('Meditation')
        ).sort((a, b) => b.timestamp - a.timestamp);
        
        // Keep only the first one (latest), delete the rest
        if (sept28Sessions.length > 1 && session.id !== sept28Sessions[0].id) {
          shouldDelete = true;
          reason = 'Sunday - duplicate meditation session, keeping only the latest';
        }
      }
      
      // Monday Sept 23 - keep only the LATEST meditation session
      else if (session.date === '2025-09-23' && session.sessionTypes.includes('Meditation')) {
        const sept23Sessions = sessionsData.filter(s => 
          s.date === '2025-09-23' && s.sessionTypes.includes('Meditation')
        ).sort((a, b) => b.timestamp - a.timestamp);
        
        // Keep only the first one (latest), delete the rest
        if (sept23Sessions.length > 1 && session.id !== sept23Sessions[0].id) {
          shouldDelete = true;
          reason = 'Monday - duplicate meditation session, keeping only the latest';
        }
      }
      
      // Sept 29 - keep "Calves, Bike", delete solo "Bike"
      else if (session.date === '2025-09-29') {
        if (session.sessionTypes.length === 1 && session.sessionTypes[0] === 'Bike') {
          shouldDelete = true;
          reason = 'Sept 29 - removing solo Bike session, keeping Calves+Bike combo';
        }
      }
      
      if (shouldDelete) {
        console.log(`🗑️  Deleting ${session.date} session: ${session.sessionTypes.join(', ')} - ${reason}`);
        try {
          await deleteDoc(doc(db, 'users', uid, 'sessions', session.id));
          deletedCount++;
        } catch (e) {
          console.error(`Failed to delete ${session.id}:`, e);
        }
      } else {
        console.log(`✅ Keeping ${session.date} session: ${session.sessionTypes.join(', ')}`);
      }
    }
    
    console.log(`✅ Cleanup complete! Deleted ${deletedCount} corrupted sessions.`);
    console.log('📊 All previous week benchmark data preserved');
    
    alert(`Cleanup complete! Deleted ${deletedCount} sessions. Refresh History to see clean data.`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    console.log('Please try the manual Firebase Console approach instead.');
  }
}

// Run the cleanup
directCleanup();
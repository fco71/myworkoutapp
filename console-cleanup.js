// SIMPLE CLEANUP SCRIPT
// 1. Refresh your workout app page (http://localhost:8001)
// 2. Go to History tab  
// 3. Copy and paste this entire script into your browser console
// 4. Press Enter to run

async function simpleCleanup() {
  console.log('🔍 Starting targeted cleanup...');
  
  // Use the globally exposed Firebase objects
  const auth = window.appAuth;
  const db = window.appDb;
  const collection = window.appCollection;
  const getDocs = window.appGetDocs;
  const deleteDoc = window.appDeleteDoc;
  const doc = window.appDoc;
  
  if (!auth || !db) {
    console.error('❌ Firebase objects not found. Please refresh the page and try again.');
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error('❌ Not signed in. Please sign in first.');
    return;
  }
  
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
simpleCleanup();
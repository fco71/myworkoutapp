// WORKING FIREBASE CLEANUP - Uses your app's existing Firebase setup
// Copy and paste this into console

async function workingCleanup() {
  console.log('🔍 Starting working Firebase cleanup...');
  
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
    // Use the actual Firebase object methods that your app is using
    // Get a reference to the sessions collection
    const sessionsCollectionPath = `users/${uid}/sessions`;
    
    // Use the internal Firebase methods
    const firestoreInstance = db;
    console.log('Firestore instance:', firestoreInstance);
    
    // Try to access the _delegate property which contains the actual Firestore methods
    const actualDb = firestoreInstance._delegate || firestoreInstance;
    
    // Get the collection reference using the path
    const sessionsQuery = actualDb.collection ? 
      actualDb.collection(sessionsCollectionPath) : 
      null;
    
    if (!sessionsQuery) {
      console.error('❌ Could not access collection method');
      console.log('Try the manual Firebase Console approach instead.');
      console.log('Go to: https://console.firebase.google.com');
      console.log('Navigate to: Firestore Database > users > vdzmEhOuuzS9eUPPLIRScn8fziK2 > sessions');
      
      console.log('🗑️ MANUAL DELETION GUIDE:');
      console.log('Delete these sessions:');
      console.log('- Sept 28: Delete 12:28:46 AM and 12:28:47 AM Meditation sessions, keep 2:38:19 PM');
      console.log('- Sept 23: Delete 10:06:08 PM and 10:06:09 PM Meditation sessions, keep 10:06:11 PM');  
      console.log('- Sept 29: Delete the solo "Bike" session, keep "Calves, Bike"');
      console.log('- Sept 26: Delete any sessions if they exist');
      
      return;
    }
    
    // Get all documents
    const snapshot = await sessionsQuery.get();
    console.log(`Found ${snapshot.docs.length} total sessions`);
    
    let deletedCount = 0;
    const sessionsData = [];
    
    // Collect all session data
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const date = data.dateISO || new Date(data.completedAt || data.ts || 0).toISOString().split('T')[0];
      const sessionTypes = data.sessionTypes || [];
      const timestamp = data.completedAt || data.ts || 0;
      
      sessionsData.push({
        id: docSnap.id,
        date,
        sessionTypes,
        timestamp,
        docRef: docSnap.ref
      });
    });
    
    // Sort and display sessions
    sessionsData.sort((a, b) => a.date.localeCompare(b.date) || (b.timestamp - a.timestamp));
    
    console.log('📊 All sessions found:');
    sessionsData.forEach(s => {
      console.log(`${s.date}: ${s.sessionTypes.join(', ')} (${new Date(s.timestamp).toLocaleString()})`);
    });
    
    // Apply deletion logic
    for (const session of sessionsData) {
      let shouldDelete = false;
      let reason = '';
      
      // Friday Sept 26 - delete ALL sessions
      if (session.date === '2025-09-26') {
        shouldDelete = true;
        reason = 'Friday - you did nothing, removing incorrect session';
      }
      
      // Sunday Sept 28 - keep only the LATEST meditation session
      else if (session.date === '2025-09-28' && session.sessionTypes.includes('Meditation')) {
        const sept28Sessions = sessionsData.filter(s => 
          s.date === '2025-09-28' && s.sessionTypes.includes('Meditation')
        ).sort((a, b) => b.timestamp - a.timestamp);
        
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
          await session.docRef.delete();
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
    console.log('');
    console.log('🔧 MANUAL FIREBASE CONSOLE APPROACH:');
    console.log('1. Go to: https://console.firebase.google.com');
    console.log('2. Select your project');
    console.log('3. Go to Firestore Database');
    console.log('4. Navigate to: users > vdzmEhOuuzS9eUPPLIRScn8fziK2 > sessions');
    console.log('');
    console.log('🗑️ Delete these specific sessions:');
    console.log('- Sept 28 (2025-09-28): Delete the 12:28:46 AM and 12:28:47 AM Meditation sessions');
    console.log('- Sept 23 (2025-09-23): Delete the 10:06:08 PM and 10:06:09 PM Meditation sessions');
    console.log('- Sept 29 (2025-09-29): Delete the solo "Bike" session (keep "Calves, Bike")');
    console.log('- Sept 26 (2025-09-26): Delete any sessions if they exist');
  }
}

// Run the cleanup
workingCleanup();
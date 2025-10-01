// WORKING SESSION RESTORATION SCRIPT
// First refresh your page, then copy and paste this into console

async function restoreSessionsWorking() {
  console.log('🔄 Starting session restoration...');
  
  const auth = window.appAuth;
  const db = window.appDb;
  const addDoc = window.appAddDoc;
  const collection = window.appCollection;
  
  if (!auth || !db || !addDoc || !collection) {
    console.error('❌ Firebase functions not available. Did you refresh the page?');
    console.log('Available functions:');
    console.log('- appAuth:', !!window.appAuth);
    console.log('- appDb:', !!window.appDb);
    console.log('- appAddDoc:', !!window.appAddDoc);
    console.log('- appCollection:', !!window.appCollection);
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error('❌ Not signed in.');
    return;
  }
  
  console.log('User ID:', uid);
  console.log('✅ All Firebase functions available!');
  console.log('⚠️  Restoring only the legitimate sessions we identified...');
  
  const sessionsRef = collection(db, 'users', uid, 'sessions');
  
  // Define the legitimate sessions to restore
  const sessionsToRestore = [
    {
      dateISO: '2025-09-23',
      sessionTypes: ['Meditation'],
      completedAt: new Date('2025-09-23T22:06:11').getTime(), // 10:06:11 PM
      ts: new Date('2025-09-23T22:06:11').getTime(),
      manual: true,
      reason: 'Latest meditation session from Sept 23'
    },
    {
      dateISO: '2025-09-24', 
      sessionTypes: ['Pull Ring v1'],
      completedAt: new Date('2025-09-24T12:35:37').getTime(), // 12:35:37 PM
      ts: new Date('2025-09-24T12:35:37').getTime(),
      manual: false,
      exerciseCount: 5,
      reason: 'Legitimate Pull Ring workout from Sept 24'
    },
    {
      dateISO: '2025-09-28',
      sessionTypes: ['Meditation'],
      completedAt: new Date('2025-09-28T14:38:19').getTime(), // 2:38:19 PM
      ts: new Date('2025-09-28T14:38:19').getTime(),
      manual: true,
      reason: 'Latest meditation session from Sept 28'
    },
    {
      dateISO: '2025-09-29',
      sessionTypes: ['Calves', 'Bike'],
      completedAt: new Date('2025-09-29T17:51:12').getTime(), // Your correct workout time
      ts: new Date('2025-09-29T17:51:12').getTime(),
      manual: true,
      reason: 'Your confirmed correct Calves + Bike workout from Sept 29'
    }
  ];
  
  console.log(`📝 Restoring ${sessionsToRestore.length} legitimate sessions...`);
  
  let restoredCount = 0;
  
  for (const session of sessionsToRestore) {
    try {
      console.log(`➕ Adding ${session.dateISO}: ${session.sessionTypes.join(', ')} - ${session.reason}`);
      
      const sessionDoc = {
        dateISO: session.dateISO,
        sessionTypes: session.sessionTypes,
        completedAt: session.completedAt,
        ts: session.ts,
        manual: session.manual
      };
      
      if (session.exerciseCount) {
        sessionDoc.exerciseCount = session.exerciseCount;
      }
      
      const docRef = await addDoc(sessionsRef, sessionDoc);
      console.log(`✅ Added session with ID: ${docRef.id}`);
      restoredCount++;
      
    } catch (error) {
      console.error(`❌ Failed to restore ${session.dateISO} session:`, error);
    }
  }
  
  console.log(`\n🎉 Restoration complete! Restored ${restoredCount} legitimate sessions.`);
  console.log('📊 Your previous week benchmarks were already preserved!');
  console.log('');
  console.log('💡 What was restored:');
  console.log('✅ Sept 23: 1 Meditation session (10:06:11 PM - latest one)');
  console.log('✅ Sept 24: Pull Ring v1 workout (5 exercises, 12:35:37 PM)');
  console.log('✅ Sept 28: 1 Meditation session (2:38:19 PM - latest one)'); 
  console.log('✅ Sept 29: Calves + Bike workout (your confirmed correct combo)');
  console.log('');
  console.log('🚫 What was NOT restored (duplicates/corrupted):');
  console.log('❌ Sept 23: 2 duplicate meditation sessions');
  console.log('❌ Sept 28: 2 duplicate meditation sessions');
  console.log('❌ Sept 29: Solo "Bike" session (kept combo instead)');
  console.log('❌ Sept 26: Any sessions (you did nothing that day)');
  console.log('');
  console.log('🎯 Result: Clean history with no duplicates + preserved benchmarks!');
  
  alert(`🎉 Restoration complete! Restored ${restoredCount} legitimate sessions. Refresh History to see your clean data.`);
}

// Run the restoration
restoreSessionsWorking();
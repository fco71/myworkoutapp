// SIMPLE SESSION ID LISTER - Copy and paste this into console
// Uses the Firebase objects already loaded in your app

async function getSessionIds() {
  console.log('🔍 Finding all session document IDs...');
  
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
  
  try {
    // Use the globally exposed Firebase functions
    const collection = window.appCollection;
    const getDocs = window.appGetDocs;
    
    if (!collection || !getDocs) {
      console.error('❌ Firebase functions not found. Need manual approach.');
      showManualInstructions();
      return;
    }
    
    const sessionsRef = collection(db, 'users', uid, 'sessions');
    const snapshot = await getDocs(sessionsRef);
    
    console.log(`Found ${snapshot.docs.length} total sessions`);
    console.log('');
    
    const sessionsData = [];
    
    // Collect all session data with document IDs
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const date = data.dateISO || new Date(data.completedAt || data.ts || 0).toISOString().split('T')[0];
      const sessionTypes = data.sessionTypes || [];
      const timestamp = data.completedAt || data.ts || 0;
      const timeString = new Date(timestamp).toLocaleString();
      
      sessionsData.push({
        id: docSnap.id,
        date,
        sessionTypes,
        timestamp,
        timeString
      });
    });
    
    // Sort by date and time
    sessionsData.sort((a, b) => a.date.localeCompare(b.date) || (a.timestamp - b.timestamp));
    
    console.log('📋 ALL SESSIONS WITH DOCUMENT IDs:');
    console.log('=====================================');
    
    // Group by date for easier reading
    const sessionsByDate = {};
    sessionsData.forEach(session => {
      if (!sessionsByDate[session.date]) {
        sessionsByDate[session.date] = [];
      }
      sessionsByDate[session.date].push(session);
    });
    
    Object.keys(sessionsByDate).sort().forEach(date => {
      console.log(`\n📅 ${date}:`);
      sessionsByDate[date].forEach(session => {
        console.log(`   🆔 ${session.id}`);
        console.log(`   📝 ${session.sessionTypes.join(', ')}`);
        console.log(`   ⏰ ${session.timeString}`);
        console.log(`   ---`);
      });
    });
    
    console.log('\n🗑️ DOCUMENT IDs TO DELETE:');
    console.log('===========================');
    
    const idsToDelete = [];
    
    // Sept 28 - delete the 2 earlier meditation sessions
    const sept28Sessions = sessionsByDate['2025-09-28'] || [];
    const sept28Meditations = sept28Sessions.filter(s => s.sessionTypes.includes('Meditation'))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    if (sept28Meditations.length >= 3) {
      console.log('\n🗑️ Sept 28 - DELETE these 2 early meditation sessions:');
      idsToDelete.push(sept28Meditations[0].id);
      idsToDelete.push(sept28Meditations[1].id);
      console.log(`   ❌ ${sept28Meditations[0].id}`);
      console.log(`   ❌ ${sept28Meditations[1].id}`);
      console.log(`   ✅ KEEP: ${sept28Meditations[2].id} (Latest)`);
    }
    
    // Sept 23 - delete the 2 earlier meditation sessions  
    const sept23Sessions = sessionsByDate['2025-09-23'] || [];
    const sept23Meditations = sept23Sessions.filter(s => s.sessionTypes.includes('Meditation'))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    if (sept23Meditations.length >= 3) {
      console.log('\n🗑️ Sept 23 - DELETE these 2 early meditation sessions:');
      idsToDelete.push(sept23Meditations[0].id);
      idsToDelete.push(sept23Meditations[1].id);
      console.log(`   ❌ ${sept23Meditations[0].id}`);
      console.log(`   ❌ ${sept23Meditations[1].id}`);
      console.log(`   ✅ KEEP: ${sept23Meditations[2].id} (Latest)`);
    }
    
    // Sept 29 - delete solo "Bike" session
    const sept29Sessions = sessionsByDate['2025-09-29'] || [];
    const soloBike = sept29Sessions.find(s => s.sessionTypes.length === 1 && s.sessionTypes[0] === 'Bike');
    const calvesBike = sept29Sessions.find(s => s.sessionTypes.includes('Calves') && s.sessionTypes.includes('Bike'));
    
    if (soloBike) {
      console.log('\n🗑️ Sept 29 - DELETE solo Bike session:');
      idsToDelete.push(soloBike.id);
      console.log(`   ❌ ${soloBike.id}`);
    }
    if (calvesBike) {
      console.log(`   ✅ KEEP: ${calvesBike.id} (Calves + Bike)`);
    }
    
    // Sept 26 - delete any sessions
    const sept26Sessions = sessionsByDate['2025-09-26'] || [];
    if (sept26Sessions.length > 0) {
      console.log('\n🗑️ Sept 26 - DELETE all sessions:');
      sept26Sessions.forEach(session => {
        idsToDelete.push(session.id);
        console.log(`   ❌ ${session.id}`);
      });
    }
    
    console.log('\n📝 SUMMARY - COPY THESE IDs TO DELETE:');
    console.log('======================================');
    idsToDelete.forEach(id => {
      console.log(id);
    });
    
    console.log('\n🔗 Firebase Console URL:');
    console.log('https://console.firebase.google.com/project/fcoworkout/firestore/data/~2Fusers~2FvdzmEhOuuzS9eUPPLIRScn8fziK2~2Fsessions');
    
  } catch (error) {
    console.error('❌ Error listing sessions:', error);
    showManualInstructions();
  }
}

function showManualInstructions() {
  console.log('\n🔧 MANUAL FIREBASE CONSOLE APPROACH:');
  console.log('====================================');
  console.log('1. Go to: https://console.firebase.google.com');
  console.log('2. Select project: fcoworkout');
  console.log('3. Go to Firestore Database');
  console.log('4. Navigate to: users > vdzmEhOuuzS9eUPPLIRScn8fziK2 > sessions');
  console.log('');
  console.log('🗑️ Delete sessions based on timestamps:');
  console.log('- Sept 28: Delete 12:28:46 AM and 12:28:47 AM Meditation, keep 2:38:19 PM');
  console.log('- Sept 23: Delete 10:06:08 PM and 10:06:09 PM Meditation, keep 10:06:11 PM');
  console.log('- Sept 29: Delete solo "Bike" session, keep "Calves, Bike"');
  console.log('- Sept 26: Delete any sessions if they exist');
}

// Run the session ID finder
getSessionIds();
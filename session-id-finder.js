// SESSION ID FINDER - Copy and paste this into console
// This will show you all session document IDs so you can delete the specific ones

async function listSessionIds() {
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
    // Use the existing Firebase functions that are already loaded in your app
    const { collection, getDocs } = await import('firebase/firestore');
    
    // Try to use the exposed functions first
    let sessionsRef, snapshot;
    
    if (window.appCollection && window.appGetDocs) {
      console.log('Using exposed Firebase functions...');
      sessionsRef = window.appCollection(db, 'users', uid, 'sessions');
      snapshot = await window.appGetDocs(sessionsRef);
    } else {
      console.log('Using imported Firebase functions...');
      sessionsRef = collection(db, 'users', uid, 'sessions');
      snapshot = await getDocs(sessionsRef);
    }
    
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
    
    console.log('\n🗑️ SESSIONS TO DELETE (based on timestamps):');
    console.log('==============================================');
    
    // Sept 28 - delete the 2 earlier meditation sessions
    const sept28Sessions = sessionsByDate['2025-09-28'] || [];
    const sept28Meditations = sept28Sessions.filter(s => s.sessionTypes.includes('Meditation'))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    if (sept28Meditations.length >= 3) {
      console.log('\n🗑️ Sept 28 - DELETE these 2 early meditation sessions:');
      console.log(`   ❌ ${sept28Meditations[0].id} (${sept28Meditations[0].timeString})`);
      console.log(`   ❌ ${sept28Meditations[1].id} (${sept28Meditations[1].timeString})`);
      console.log(`   ✅ KEEP: ${sept28Meditations[2].id} (${sept28Meditations[2].timeString}) - Latest`);
    }
    
    // Sept 23 - delete the 2 earlier meditation sessions  
    const sept23Sessions = sessionsByDate['2025-09-23'] || [];
    const sept23Meditations = sept23Sessions.filter(s => s.sessionTypes.includes('Meditation'))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    if (sept23Meditations.length >= 3) {
      console.log('\n🗑️ Sept 23 - DELETE these 2 early meditation sessions:');
      console.log(`   ❌ ${sept23Meditations[0].id} (${sept23Meditations[0].timeString})`);
      console.log(`   ❌ ${sept23Meditations[1].id} (${sept23Meditations[1].timeString})`);
      console.log(`   ✅ KEEP: ${sept23Meditations[2].id} (${sept23Meditations[2].timeString}) - Latest`);
    }
    
    // Sept 29 - delete solo "Bike" session
    const sept29Sessions = sessionsByDate['2025-09-29'] || [];
    const soloBike = sept29Sessions.find(s => s.sessionTypes.length === 1 && s.sessionTypes[0] === 'Bike');
    const calvesBike = sept29Sessions.find(s => s.sessionTypes.includes('Calves') && s.sessionTypes.includes('Bike'));
    
    if (soloBike) {
      console.log('\n🗑️ Sept 29 - DELETE solo Bike session:');
      console.log(`   ❌ ${soloBike.id} (${soloBike.timeString}) - Solo Bike`);
    }
    if (calvesBike) {
      console.log(`   ✅ KEEP: ${calvesBike.id} (${calvesBike.timeString}) - Calves + Bike`);
    }
    
    // Sept 26 - delete any sessions
    const sept26Sessions = sessionsByDate['2025-09-26'] || [];
    if (sept26Sessions.length > 0) {
      console.log('\n🗑️ Sept 26 - DELETE all sessions (you did nothing):');
      sept26Sessions.forEach(session => {
        console.log(`   ❌ ${session.id} (${session.timeString}) - ${session.sessionTypes.join(', ')}`);
      });
    }
    
    console.log('\n📝 COPY THESE DOCUMENT IDS TO DELETE MANUALLY IN FIREBASE CONSOLE');
    
  } catch (error) {
    console.error('❌ Error listing sessions:', error);
    console.log('Please try using the Firebase Console directly.');
  }
}

// Run the session ID finder
listSessionIds();
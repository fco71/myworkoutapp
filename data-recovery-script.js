// Comprehensive Firebase Data Recovery Script
// Run this in the browser console on the workout app page

async function comprehensiveDataRecovery() {
  try {
    console.log('🔧 Starting comprehensive data recovery...');
    
    const user = appAuth.currentUser;
    if (!user) {
      console.log('❌ No user signed in');
      return;
    }
    
    console.log('👤 User:', user.uid);
    
    // 1. Check all collections under user
    console.log('\n🗂️ Checking all user collections...');
    
    // Check sessions collection (where workout sessions might be stored)
    try {
      const sessionsRef = appCollection(appDb, 'users', user.uid, 'sessions');
      const sessionsSnap = await appGetDocs(sessionsRef);
      console.log(`📋 Sessions collection: ${sessionsSnap.docs.length} documents`);
      
      if (sessionsSnap.docs.length > 0) {
        console.log('🎯 Found session documents! Analyzing...');
        sessionsSnap.docs.forEach((doc, index) => {
          const data = doc.data();
          console.log(`  Session ${index + 1} (${doc.id}):`, data);
        });
      }
    } catch (error) {
      console.log('⚠️ Sessions collection not accessible or empty');
    }
    
    // 2. Check workouts collection
    try {
      const workoutsRef = appCollection(appDb, 'users', user.uid, 'workouts');
      const workoutsSnap = await appGetDocs(workoutsRef);
      console.log(`🏋️ Workouts collection: ${workoutsSnap.docs.length} documents`);
      
      if (workoutsSnap.docs.length > 0) {
        console.log('🎯 Found workout documents! Analyzing...');
        workoutsSnap.docs.forEach((doc, index) => {
          const data = doc.data();
          console.log(`  Workout ${index + 1} (${doc.id}):`, data);
        });
      }
    } catch (error) {
      console.log('⚠️ Workouts collection not accessible or empty');
    }
    
    // 3. Check for any data in state documents that might have workout info
    console.log('\n📊 Deep analysis of state documents...');
    const stateCollection = appCollection(appDb, 'users', user.uid, 'state');
    const stateSnapshot = await appGetDocs(stateCollection);
    
    stateSnapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log(`\n📋 State Document: ${doc.id}`);
      console.log('Full document structure:', JSON.stringify(data, null, 2));
      
      // Check for any non-empty days
      if (data.weekly?.days) {
        data.weekly.days.forEach((day, index) => {
          if (day.types && Object.keys(day.types).length > 0) {
            console.log(`  Day ${index}: Has ${Object.keys(day.types).length} workout types`);
            console.log(`    Types:`, day.types);
          }
        });
      }
    });
    
    // 4. Check root-level collections that might contain user data
    console.log('\n🌐 Checking root-level collections...');
    
    try {
      // Check if there's a global sessions collection
      const globalSessionsRef = appCollection(appDb, 'sessions');
      const globalSessionsQuery = appQuery(globalSessionsRef, appWhere('userId', '==', user.uid));
      const globalSessionsSnap = await appGetDocs(globalSessionsQuery);
      console.log(`🌍 Global sessions for user: ${globalSessionsSnap.docs.length} documents`);
      
      if (globalSessionsSnap.docs.length > 0) {
        console.log('🎯 Found global session documents! Analyzing...');
        globalSessionsSnap.docs.forEach((doc, index) => {
          const data = doc.data();
          console.log(`  Global Session ${index + 1} (${doc.id}):`, data);
        });
      }
    } catch (error) {
      console.log('⚠️ Global sessions collection not accessible');
    }
    
    // 5. Check browser storage for cached data
    console.log('\n💾 Checking browser storage...');
    
    // Local storage
    const localStorageKeys = Object.keys(localStorage).filter(key => 
      key.includes('workout') || key.includes('session') || key.includes('firebase')
    );
    console.log(`📱 Local storage keys related to workouts: ${localStorageKeys.length}`);
    localStorageKeys.forEach(key => {
      try {
        const value = localStorage.getItem(key);
        console.log(`  ${key}:`, JSON.parse(value));
      } catch {
        console.log(`  ${key}:`, value);
      }
    });
    
    // Session storage
    const sessionStorageKeys = Object.keys(sessionStorage).filter(key => 
      key.includes('workout') || key.includes('session') || key.includes('firebase')
    );
    console.log(`🔄 Session storage keys related to workouts: ${sessionStorageKeys.length}`);
    sessionStorageKeys.forEach(key => {
      try {
        const value = sessionStorage.getItem(key);
        console.log(`  ${key}:`, JSON.parse(value));
      } catch {
        console.log(`  ${key}:`, value);
      }
    });
    
    console.log('\n✅ Data recovery analysis complete!');
    console.log('📋 Summary:');
    console.log('- Check console output above for any found data');
    console.log('- Look for documents with workout completions');
    console.log('- Any found data can be used to restore workout history');
    
  } catch (error) {
    console.error('❌ Error during data recovery:', error);
  }
}

// Auto-run the recovery check
comprehensiveDataRecovery();
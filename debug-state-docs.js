// Debug script to check what state documents exist
// Run this in the browser console on the workout app page

async function checkStateDocuments() {
  try {
    console.log('🔍 Checking Firebase state documents...');
    
    // Get current user
    const user = appAuth.currentUser;
    if (!user) {
      console.log('❌ No user signed in');
      return;
    }
    
    console.log('👤 User:', user.uid);
    
    // Get all documents in the state collection
    const stateCollection = appCollection(appDb, 'users', user.uid, 'state');
    const snapshot = await appGetDocs(stateCollection);
    
    console.log(`📄 Found ${snapshot.docs.length} state documents:`);
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log(`📋 Document ID: ${doc.id}`);
      
      if (data.weekly) {
        const weekly = data.weekly;
        console.log(`  📅 Week ${weekly.weekNumber} (${weekly.weekOfISO})`);
        console.log(`  🏃 Custom types: ${weekly.customTypes?.length || 0}`);
        
        // Count active days
        const activeDays = weekly.days?.filter(d => 
          Object.keys(d.types || {}).some(t => d.types[t])
        ).length || 0;
        
        console.log(`  ✅ Active days: ${activeDays}/7`);
        
        // Show sample of what types were done
        const allTypes = new Set();
        weekly.days?.forEach(d => {
          Object.keys(d.types || {}).forEach(t => {
            if (d.types[t]) allTypes.add(t);
          });
        });
        
        if (allTypes.size > 0) {
          console.log(`  💪 Workout types done: ${Array.from(allTypes).join(', ')}`);
        }
      } else {
        console.log('  ⚠️ No weekly data in this document');
      }
      
      console.log('  ---');
    });
    
    // Also check current Monday
    const getMonday = (d = new Date()) => {
      const nd = new Date(d);
      const day = nd.getDay();
      const diff = (day === 0 ? -6 : 1) - day;
      nd.setDate(nd.getDate() + diff);
      nd.setHours(0, 0, 0, 0);
      return nd;
    };
    
    const toISO = (d) => {
      const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    
    const currentMonday = getMonday();
    console.log(`📅 Current Monday: ${toISO(currentMonday)}`);
    
    // Check previous 4 weeks
    for (let i = 1; i <= 4; i++) {
      const prevMonday = new Date(currentMonday);
      prevMonday.setDate(currentMonday.getDate() - (7 * i));
      const prevMondayISO = toISO(prevMonday);
      
      const hasDoc = snapshot.docs.some(doc => doc.id === prevMondayISO);
      console.log(`📅 Week -${i} (${prevMondayISO}): ${hasDoc ? '✅ Found' : '❌ Missing'}`);
    }
    
  } catch (error) {
    console.error('❌ Error checking documents:', error);
  }
}

// Auto-run the check
checkStateDocuments();
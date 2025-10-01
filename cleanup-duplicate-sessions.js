// Run this in your browser console while on your workout app
// This will clean up duplicate sessions with the same date and timestamp

async function cleanupDuplicateSessions() {
  if (typeof db === 'undefined' || typeof auth === 'undefined') {
    console.error('Firebase not available. Make sure you run this on your workout app page.');
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error('Not signed in. Please sign in to your workout app first.');
    return;
  }
  
  console.log('🔍 Starting duplicate session cleanup...');
  
  try {
    // Get all sessions
    const sessionsRef = collection(db, 'users', uid, 'sessions');
    const snapshot = await getDocs(sessionsRef);
    
    console.log(`Found ${snapshot.docs.length} total sessions`);
    
    // Group sessions by date
    const sessionsByDate = new Map();
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const date = data.dateISO || new Date(data.completedAt || data.ts || 0).toISOString().split('T')[0];
      
      if (!sessionsByDate.has(date)) {
        sessionsByDate.set(date, []);
      }
      
      sessionsByDate.get(date).push({
        id: doc.id,
        data: data,
        doc: doc
      });
    });
    
    let totalDeleted = 0;
    
    // Process each date
    for (const [date, sessions] of sessionsByDate) {
      if (sessions.length <= 1) {
        console.log(`✅ ${date}: Only ${sessions.length} session - OK`);
        continue;
      }
      
      console.log(`⚠️  ${date}: Found ${sessions.length} sessions - checking for duplicates`);
      
      // Look for sessions with same timestamp (likely duplicates)
      const timeGroups = new Map();
      
      sessions.forEach(session => {
        const timestamp = session.data.completedAt || session.data.ts || 0;
        const timeKey = Math.floor(timestamp / 60000); // Group by minute
        
        if (!timeGroups.has(timeKey)) {
          timeGroups.set(timeKey, []);
        }
        timeGroups.get(timeKey).push(session);
      });
      
      // Delete duplicates, keeping the CORRECT one based on actual workout data
      for (const [timeKey, timeGroupSessions] of timeGroups) {
        if (timeGroupSessions.length > 1) {
          console.log(`🗑️  ${date} ${new Date(timeKey * 60000).toLocaleTimeString()}: Found ${timeGroupSessions.length} sessions at same time`);
          
          // For Sept 26 (Friday), keep session with empty or minimal types (you did nothing)
          // For Sept 27 (Saturday), keep session with "Meditation" only
          // For other dates, keep the one with the most specific/least types
          let toKeep;
          
          if (date === '2025-09-26') {
            // Friday - you did NOTHING, so keep session with no sessionTypes or minimal types
            toKeep = timeGroupSessions.find(s => {
              const types = s.data.sessionTypes || [];
              return types.length === 0;
            }) || timeGroupSessions.reduce((best, current) => {
              const bestTypes = best.data.sessionTypes || [];
              const currentTypes = current.data.sessionTypes || [];
              return currentTypes.length < bestTypes.length ? current : best;
            });
          } else if (date === '2025-09-27') {
            // Saturday - keep session with "Meditation" only
            toKeep = timeGroupSessions.find(s => {
              const types = s.data.sessionTypes || [];
              return types.includes('Meditation') && !types.includes('Guitar') && !types.includes('Rings');
            }) || timeGroupSessions[0];
          } else {
            // For other dates, keep the session with fewest types (most likely to be correct)
            toKeep = timeGroupSessions.reduce((best, current) => {
              const bestTypes = best.data.sessionTypes || [];
              const currentTypes = current.data.sessionTypes || [];
              return currentTypes.length < bestTypes.length ? current : best;
            });
          }
          
          const toDelete = timeGroupSessions.filter(s => s.id !== toKeep.id);
          
          console.log(`   ✅ Keeping session ${toKeep.id}: types=[${(toKeep.data.sessionTypes || []).join(', ')}]`);
          
          for (const session of toDelete) {
            console.log(`   🗑️  Deleting session ${session.id}: types=[${(session.data.sessionTypes || []).join(', ')}]`);
            
            try {
              await deleteDoc(doc(db, 'users', uid, 'sessions', session.id));
              totalDeleted++;
            } catch (e) {
              console.error(`   ❌ Failed to delete ${session.id}:`, e);
            }
          }
        }
      }
    }
    
    console.log(`✅ Cleanup complete! Deleted ${totalDeleted} duplicate sessions.`);
    console.log('🔄 Refresh your History view to see the changes.');
    
    return `Deleted ${totalDeleted} duplicate sessions`;
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  }
}

// Run the cleanup
cleanupDuplicateSessions().then(result => {
  console.log('🎉 Cleanup result:', result);
  alert('Cleanup complete! Check console for details. Refresh your History view.');
}).catch(error => {
  console.error('💥 Cleanup error:', error);
  alert('Cleanup failed: ' + error.message);
});
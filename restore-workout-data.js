// Data Recovery Script - Restore Sessions to Weekly State
// Run this in the browser console to recover your workout data

async function restoreWorkoutData() {
  try {
    console.log('🔧 Starting workout data restoration...');
    
    const user = appAuth.currentUser;
    if (!user) {
      console.log('❌ No user signed in');
      return;
    }
    
    // Get all sessions
    const sessionsRef = appCollection(appDb, 'users', user.uid, 'sessions');
    const sessionsSnap = await appGetDocs(sessionsRef);
    
    console.log(`📋 Found ${sessionsSnap.docs.length} sessions to restore`);
    
    // Group sessions by week
    const sessionsByWeek = {};
    
    sessionsSnap.docs.forEach(doc => {
      const session = doc.data();
      console.log(`📅 Processing session ${doc.id}:`, session);
      
      // Get Monday of the week for this session
      const sessionDate = new Date(session.dateISO);
      const monday = new Date(sessionDate);
      const day = monday.getDay();
      const diff = (day === 0 ? -6 : 1) - day;
      monday.setDate(monday.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      
      const mondayISO = monday.toISOString().split('T')[0];
      
      if (!sessionsByWeek[mondayISO]) {
        sessionsByWeek[mondayISO] = [];
      }
      
      sessionsByWeek[mondayISO].push({
        id: doc.id,
        dateISO: session.dateISO,
        sessionTypes: session.sessionTypes || [],
        completedAt: session.completedAt
      });
    });
    
    console.log('📊 Sessions grouped by week:', sessionsByWeek);
    
    // Now restore each week
    for (const [weekISO, sessions] of Object.entries(sessionsByWeek)) {
      console.log(`\\n🔄 Restoring week ${weekISO}...`);
      
      // Get the current state document
      const weekRef = appDoc(appDb, 'users', user.uid, 'state', weekISO);
      const weekSnap = await appGetDoc(weekRef);
      
      if (!weekSnap.exists()) {
        console.log(`⚠️ No state document for week ${weekISO}`);
        continue;
      }
      
      const weekData = weekSnap.data();
      const updatedWeekData = { ...weekData };
      
      // Process each session for this week
      sessions.forEach(session => {
        // Find the day in the weekly data
        const dayIndex = updatedWeekData.weekly.days.findIndex(d => d.dateISO === session.dateISO);
        
        if (dayIndex !== -1) {
          console.log(`  📅 Restoring ${session.dateISO}: ${session.sessionTypes.join(', ')}`);
          
          // Update the day's types
          session.sessionTypes.forEach(type => {
            updatedWeekData.weekly.days[dayIndex].types[type] = true;
          });
          
          // Update sessions list
          updatedWeekData.weekly.days[dayIndex].sessionsList = 
            updatedWeekData.weekly.days[dayIndex].sessionsList || [];
          
          const existingSession = updatedWeekData.weekly.days[dayIndex].sessionsList.find(s => s.id === session.id);
          if (!existingSession) {
            updatedWeekData.weekly.days[dayIndex].sessionsList.push({
              id: session.id,
              sessionTypes: session.sessionTypes
            });
          }
          
          // Update session count
          updatedWeekData.weekly.days[dayIndex].sessions = 
            updatedWeekData.weekly.days[dayIndex].sessionsList.length;
        }
      });
      
      // Save the restored data
      await appSetDoc(weekRef, updatedWeekData);
      console.log(`✅ Week ${weekISO} restored successfully!`);
    }
    
    console.log('\\n🎉 Data restoration complete!');
    console.log('🔄 Please refresh the page to see your restored workout history');
    
  } catch (error) {
    console.error('❌ Error during restoration:', error);
  }
}

// Run the restoration
restoreWorkoutData();
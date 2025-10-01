/**
 * Browser Console Cleanup Script for Duplicate Sessions
 * 
 * INSTRUCTIONS:
 * 1. Open your workout app in the browser
 * 2. Make sure you're logged in
 * 3. Open browser developer tools (F12)
 * 4. Go to Console tab
 * 5. Copy and paste this entire script
 * 6. Press Enter to run
 * 
 * This will find and remove duplicate session entries while keeping the best one from each group.
 */

(async function cleanupDuplicateSessions() {
  console.log('🧹 Starting duplicate sessions cleanup...');
  
  try {
    // Check if user is logged in
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ Please log in first!');
      return;
    }
    
    console.log(`👤 Cleaning up sessions for user: ${user.uid}`);
    
    // Get all sessions
    const sessionsRef = collection(db, 'users', user.uid, 'sessions');
    const snapshot = await getDocs(sessionsRef);
    
    const sessions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log(`📊 Found ${sessions.length} total sessions`);
    
    // Group by date + sessionTypes to find duplicates
    const groups = {};
    sessions.forEach(session => {
      const key = `${session.dateISO}:${JSON.stringify((session.sessionTypes || []).sort())}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(session);
    });
    
    const duplicateGroups = Object.entries(groups).filter(([key, groupSessions]) => groupSessions.length > 1);
    
    if (duplicateGroups.length === 0) {
      console.log('✅ No duplicates found! Your data is clean.');
      return;
    }
    
    console.log(`🔍 Found ${duplicateGroups.length} groups with duplicates`);
    
    // Show what will be cleaned up
    for (const [key, groupSessions] of duplicateGroups) {
      console.log(`📅 Group: ${key} has ${groupSessions.length} duplicates:`);
      groupSessions.forEach(session => {
        console.log(`  - ${session.sessionName} (${session.exercises?.length || 0} exercises) - ${session.id}`);
      });
    }
    
    const confirmCleanup = confirm(`Found ${duplicateGroups.length} duplicate groups. This will remove ${duplicateGroups.reduce((total, [key, sessions]) => total + (sessions.length - 1), 0)} duplicate sessions. Continue?`);
    
    if (!confirmCleanup) {
      console.log('❌ Cleanup cancelled by user');
      return;
    }
    
    let duplicatesRemoved = 0;
    
    // Process each group
    for (const [key, groupSessions] of duplicateGroups) {
      console.log(`🔄 Processing group: ${key}`);
      
      // Sort to keep the best one (most exercises, then most recent)
      groupSessions.sort((a, b) => {
        // First priority: number of exercises
        const aExercises = a.exercises?.length || 0;
        const bExercises = b.exercises?.length || 0;
        if (aExercises !== bExercises) {
          return bExercises - aExercises;
        }
        // Second priority: completion time
        return (b.completedAt || 0) - (a.completedAt || 0);
      });
      
      // Keep the first (best) one, delete the rest
      const [keep, ...remove] = groupSessions;
      console.log(`✅ Keeping session: ${keep.sessionName} (${keep.exercises?.length || 0} exercises) - ${keep.id}`);
      
      for (const session of remove) {
        console.log(`🗑️  Removing duplicate: ${session.sessionName} - ${session.id}`);
        try {
          await deleteDoc(doc(db, 'users', user.uid, 'sessions', session.id));
          duplicatesRemoved++;
        } catch (error) {
          console.error(`❌ Failed to delete session ${session.id}:`, error);
        }
      }
    }
    
    console.log(`🎉 Cleanup complete! Removed ${duplicatesRemoved} duplicate sessions.`);
    console.log('💡 Refresh the page to see the updated history.');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  }
})();
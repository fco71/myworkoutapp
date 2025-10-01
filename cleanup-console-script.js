// Console cleanup script for workout app sessions
// Run this in your browser console while on your workout app

async function cleanupSessionTypes() {
  // Check if Firebase is available
  if (typeof db === 'undefined' || typeof auth === 'undefined') {
    console.error('Firebase not available. Make sure you run this on your workout app page.');
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error('Not signed in. Please sign in to your workout app first.');
    return;
  }
  
  console.log('Starting session cleanup...');
  
  try {
    // Get all sessions
    const sessionsRef = collection(db, 'users', uid, 'sessions');
    const snapshot = await getDocs(sessionsRef);
    
    console.log(`Found ${snapshot.docs.length} sessions to check`);
    
    // Define invalid workout types that should be removed
    const invalidTypes = [
      'Meditation', 'Guitar', 'Reading', 'Music', 'Art', 'Cooking', 
      'Walking', 'Relaxation', 'Study', 'Work', 'Social', 'Entertainment'
    ];
    
    let updatedCount = 0;
    
    for (const sessionDoc of snapshot.docs) {
      const sessionData = sessionDoc.data();
      const currentSessionTypes = sessionData.sessionTypes || [];
      
      // Filter out invalid types
      const cleanedSessionTypes = currentSessionTypes.filter(type => 
        !invalidTypes.includes(type)
      );
      
      // Only update if there's a change
      if (cleanedSessionTypes.length !== currentSessionTypes.length) {
        console.log(`Updating session ${sessionDoc.id} (${sessionData.dateISO}):`);
        console.log(`  Before: [${currentSessionTypes.join(', ')}]`);
        console.log(`  After:  [${cleanedSessionTypes.join(', ')}]`);
        
        await updateDoc(doc(db, 'users', uid, 'sessions', sessionDoc.id), {
          sessionTypes: cleanedSessionTypes
        });
        updatedCount++;
      }
    }
    
    console.log(`✅ Cleanup complete! Updated ${updatedCount} sessions.`);
    console.log('Refresh your History view to see the changes.');
    
    return `Updated ${updatedCount} sessions`;
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  }
}

// Run the cleanup
cleanupSessionTypes().then(result => {
  console.log('Cleanup result:', result);
}).catch(error => {
  console.error('Cleanup error:', error);
});
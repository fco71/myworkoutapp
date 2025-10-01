// Debug Previous Week Day Order
// Run this in browser console to see the actual day order in Firebase

async function debugPreviousWeekOrder() {
  try {
    console.log('🔍 Debugging previous week day order...');
    
    const user = window.appAuth.currentUser;
    if (!user) {
      console.log('❌ No user signed in');
      return;
    }

    // Check the previous week document
    const weekRef = window.appDoc(window.appDb, 'users', user.uid, 'state', '2025-09-22');
    const weekSnap = await window.appGetDoc(weekRef);
    
    if (!weekSnap.exists()) {
      console.log('❌ Previous week document not found');
      return;
    }

    const weekData = weekSnap.data();
    console.log('📄 Full week data:', weekData);
    
    if (weekData.weekly && weekData.weekly.days) {
      console.log('📅 Days array order:');
      weekData.weekly.days.forEach((day, index) => {
        const date = new Date(day.dateISO);
        const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const workouts = Object.keys(day.types || {}).filter(type => day.types[type]).join(', ') || 'None';
        
        console.log(`  Index ${index}: ${day.dateISO} (${dayNames[dayOfWeek]}) - Workouts: ${workouts}`);
      });
      
      // Check if first day is Monday
      const firstDay = weekData.weekly.days[0];
      const firstDate = new Date(firstDay.dateISO);
      const isMonday = firstDate.getDay() === 1; // 1 = Monday
      
      console.log('');
      console.log(`🎯 First day is: ${firstDay.dateISO} (${isMonday ? 'MONDAY ✅' : 'NOT MONDAY ❌'})`);
      
      if (!isMonday) {
        console.log('🔧 The days array is still in wrong order! Need to fix it.');
      } else {
        console.log('✅ Days array is correctly ordered Monday-first');
      }
    } else {
      console.log('❌ No days array found in weekly data');
    }

  } catch (error) {
    console.error('❌ Error debugging day order:', error);
  }
}

// Run the debug
debugPreviousWeekOrder();
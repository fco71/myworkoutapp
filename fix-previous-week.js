// Fix Previous Week Data Based on Conversation History
// Run this in browser console to set correct workout data

async function fixPreviousWeekData() {
  try {
    console.log('🔧 Fixing previous week data based on conversation history...');
    
    const user = appAuth.currentUser;
    if (!user) {
      console.log('❌ No user signed in');
      return;
    }

    // Based on our conversation, your actual workouts were:
    const correctWorkouts = {
      '2025-09-23': ['Bike'],        // Tuesday - Bike workout
      '2025-09-24': ['Resistance'],  // Wednesday - 5-exercise resistance session  
      '2025-09-28': ['Calves', 'Bike'], // Sunday - Calves + Bike (you always combine these)
      '2025-09-29': ['Calves', 'Bike']  // Monday current week - Calves + Bike
    };

    console.log('📋 Correct workout schedule:');
    Object.entries(correctWorkouts).forEach(([date, types]) => {
      console.log(`  ${date}: ${types.join(' + ')}`);
    });

    // Fix the previous week (2025-09-22)
    const weekRef = appDoc(appDb, 'users', user.uid, 'state', '2025-09-22');
    const weekSnap = await appGetDoc(weekRef);
    
    if (!weekSnap.exists()) {
      console.log('❌ Previous week document not found');
      return;
    }

    const weekData = weekSnap.data();
    const updatedWeekData = JSON.parse(JSON.stringify(weekData));

    // The existing days array might be in Sunday-first order, we need Monday-first
    // Let's rebuild the days array from scratch in correct Monday-first order
    const weekStartMonday = new Date('2025-09-22'); // Previous week Monday
    const correctDaysOrder = [];
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStartMonday);
      d.setDate(weekStartMonday.getDate() + i);
      const dateISO = d.toISOString().split('T')[0];
      
      correctDaysOrder.push({
        dateISO,
        types: {},
        sessions: 0,
        sessionsList: [],
        comments: {},
      });
    }
    
    // Replace the days array with properly ordered one
    updatedWeekData.weekly.days = correctDaysOrder;
    
    console.log('🧹 Cleared all data and rebuilt days array in Monday-first order');
    console.log('📅 New days order:', correctDaysOrder.map(d => d.dateISO));

    // Set correct workouts for previous week only (Sept 23, 24, 28)
    const previousWeekWorkouts = {
      '2025-09-23': ['Bike'],
      '2025-09-24': ['Resistance'], 
      '2025-09-28': ['Calves', 'Bike']
    };

    Object.entries(previousWeekWorkouts).forEach(([dateISO, workoutTypes]) => {
      const dayIndex = updatedWeekData.weekly.days.findIndex(d => d.dateISO === dateISO);
      
      if (dayIndex !== -1) {
        console.log(`📅 Setting ${dateISO}: ${workoutTypes.join(' + ')}`);
        
        // Set workout types
        workoutTypes.forEach(type => {
          updatedWeekData.weekly.days[dayIndex].types[type] = true;
        });
        
        // Set session metadata
        updatedWeekData.weekly.days[dayIndex].sessions = 1;
        updatedWeekData.weekly.days[dayIndex].sessionsList = [{
          sessionTypes: workoutTypes
        }];
        
        // Clear any problematic fields
        updatedWeekData.weekly.days[dayIndex].comments = {};
      }
    });

    // Clean any undefined values
    const cleanData = JSON.parse(JSON.stringify(updatedWeekData, (_key, value) => {
      return value === undefined ? null : value;
    }));

    // Save to Firebase
    await appSetDoc(weekRef, cleanData);
    
    console.log('✅ Previous week data fixed successfully!');
    console.log('');
    console.log('📊 Summary of your ACTUAL workouts last week:');
    console.log('  Tuesday 9/23: 🚴 Bike');
    console.log('  Wednesday 9/24: 💪 Resistance (5 exercises)');
    console.log('  Sunday 9/28: 🦵 Calves + 🚴 Bike');
    console.log('');
    console.log('🔄 Please refresh the page to see corrected data');

  } catch (error) {
    console.error('❌ Error fixing data:', error);
  }
}

// Run the fix
fixPreviousWeekData();
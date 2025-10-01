// Correct Previous Week with Actual Workouts
async function correctPreviousWeek() {
  const user = window.appAuth.currentUser;
  if (!user) return console.log('Not signed in');
  
  const weekRef = window.appDoc(window.appDb, 'users', user.uid, 'state', '2025-09-22');
  const weekSnap = await window.appGetDoc(weekRef);
  
  if (!weekSnap.exists()) return console.log('No previous week data');
  
  const weekData = weekSnap.data();
  
  // Your actual workout schedule from conversation
  const actualWorkouts = {
    '2025-09-23': ['Bike'],                    // Tuesday - Bike only
    '2025-09-24': ['Resistance'],              // Wednesday - 5-exercise resistance
    '2025-09-28': ['Calves', 'Bike']           // Sunday - Calves + Bike (always together)
  };
  
  console.log('Setting correct workouts:');
  Object.entries(actualWorkouts).forEach(([date, types]) => {
    console.log(`  ${date}: ${types.join(' + ')}`);
  });
  
  // Clear all days first
  weekData.weekly.days.forEach(day => {
    day.types = {};
    day.sessions = 0;
    day.sessionsList = [];
  });
  
  // Set the correct workouts
  Object.entries(actualWorkouts).forEach(([dateISO, workoutTypes]) => {
    const dayIndex = weekData.weekly.days.findIndex(d => d.dateISO === dateISO);
    
    if (dayIndex !== -1) {
      console.log(`✅ Setting ${dateISO}: ${workoutTypes.join(' + ')}`);
      
      // Set workout types
      workoutTypes.forEach(type => {
        weekData.weekly.days[dayIndex].types[type] = true;
      });
      
      // Set session metadata
      weekData.weekly.days[dayIndex].sessions = 1;
      weekData.weekly.days[dayIndex].sessionsList = [{
        sessionTypes: workoutTypes
      }];
    }
  });
  
  // Update to only include your actual workout types (including missing ones)
  const yourWorkoutTypes = ['Bike', 'Resistance', 'Calves', 'Meditation', 'Guitar'];
  
  const correctedWeekData = {
    ...weekData,
    weekly: {
      ...weekData.weekly,
      customTypes: yourWorkoutTypes,
      benchmarks: {
        Bike: 3,
        Resistance: 3, 
        Calves: 3,
        Meditation: 4,
        Guitar: 4
      },
      typeCategories: {
        Bike: 'Cardio',
        Resistance: 'Resistance', 
        Calves: 'Resistance',
        Meditation: 'Mindfulness',
        Guitar: 'Skills'
      }
    }
  };
  
  await window.appSetDoc(weekRef, correctedWeekData);
  
  console.log('✅ Previous week corrected!');
  console.log('📊 Your actual workouts:');
  console.log('  Tuesday 9/23: 🚴 Bike');
  console.log('  Wednesday 9/24: 💪 Resistance (5 exercises)');
  console.log('  Sunday 9/28: 🦵 Calves + 🚴 Bike');
  console.log('');
  console.log('🎯 Available workout types: Bike, Resistance, Calves, Meditation, Guitar');
  console.log('🔄 Refresh the page to see the corrected data');
}

correctPreviousWeek();
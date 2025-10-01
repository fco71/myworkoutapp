// Fix Day Mapping and Previous Week Data
// Run this in browser console to fix both day mapping and workout data

async function fixDayMappingAndData() {
  try {
    console.log('🔧 Fixing day mapping and previous week data...');
    
    const user = appAuth.currentUser;
    if (!user) {
      console.log('❌ No user signed in');
      return;
    }

    // Get the previous week document
    const weekRef = appDoc(appDb, 'users', user.uid, 'state', '2025-09-22');
    const weekSnap = await appGetDoc(weekRef);
    
    if (!weekSnap.exists()) {
      console.log('❌ Previous week document not found');
      return;
    }

    const weekData = weekSnap.data();
    console.log('📋 Current week structure:', weekData.weekly.days.map(d => d.dateISO));

    // Your actual workouts from our conversation:
    const correctWorkouts = {
      '2025-09-23': ['Bike'],           // Tuesday
      '2025-09-24': ['Resistance'],     // Wednesday  
      '2025-09-28': ['Calves', 'Bike']  // Sunday
    };

    console.log('✅ Setting correct workouts:');
    Object.entries(correctWorkouts).forEach(([date, types]) => {
      const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
      console.log(`  ${dayOfWeek} ${date}: ${types.join(' + ')}`);
    });

    // Create a fresh weekly structure with correct day mapping
    const updatedWeekData = JSON.parse(JSON.stringify(weekData));
    
    // Ensure all days exist and are clean
    const expectedDays = [
      '2025-09-22', // Monday
      '2025-09-23', // Tuesday  
      '2025-09-24', // Wednesday
      '2025-09-25', // Thursday
      '2025-09-26', // Friday
      '2025-09-27', // Saturday
      '2025-09-28'  // Sunday
    ];

    // Rebuild the days array in proper order
    updatedWeekData.weekly.days = expectedDays.map(dateISO => {
      // Find existing day or create new one
      const existingDay = weekData.weekly.days.find(d => d.dateISO === dateISO) || {
        dateISO: dateISO,
        types: {},
        sessions: 0,
        sessionsList: [],
        comments: {}
      };

      // Clear and reset
      const cleanDay = {
        dateISO: dateISO,
        types: {},
        sessions: 0,
        sessionsList: [],
        comments: {}
      };

      // Set correct workouts if this day has them
      if (correctWorkouts[dateISO]) {
        const workoutTypes = correctWorkouts[dateISO];
        workoutTypes.forEach(type => {
          cleanDay.types[type] = true;
        });
        cleanDay.sessions = 1;
        cleanDay.sessionsList = [{
          sessionTypes: workoutTypes
        }];
      }

      return cleanDay;
    });

    console.log('🧹 Rebuilt days array in Monday-Sunday order');
    console.log('📋 New structure:', updatedWeekData.weekly.days.map(d => ({
      date: d.dateISO,
      day: new Date(d.dateISO).toLocaleDateString('en-US', { weekday: 'short' }),
      workouts: Object.keys(d.types).filter(t => d.types[t])
    })));

    // Clean undefined values
    const cleanData = JSON.parse(JSON.stringify(updatedWeekData, (_key, value) => {
      return value === undefined ? null : value;
    }));

    // Save to Firebase
    await appSetDoc(weekRef, cleanData);
    
    console.log('✅ Day mapping and workout data fixed successfully!');
    console.log('');
    console.log('📊 Your workouts are now correctly mapped:');
    console.log('  Monday 9/22: — (no workouts)');
    console.log('  Tuesday 9/23: 🚴 Bike');
    console.log('  Wednesday 9/24: 💪 Resistance');
    console.log('  Thursday 9/25: — (no workouts)');
    console.log('  Friday 9/26: — (no workouts)');
    console.log('  Saturday 9/27: — (no workouts)');
    console.log('  Sunday 9/28: 🦵 Calves + 🚴 Bike');
    console.log('');
    console.log('🔄 Please refresh the page to see corrected display');

  } catch (error) {
    console.error('❌ Error fixing day mapping:', error);
  }
}

// Run the fix
fixDayMappingAndData();
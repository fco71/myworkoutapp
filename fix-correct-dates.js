// CORRECTED Previous Week Rebuild Script
// September 23, 2025 was the MONDAY of that week, not September 22

async function fixPreviousWeekCorrectDates() {
  try {
    console.log('🚨 REBUILDING with CORRECT Monday start date...');
    
    const user = window.appAuth.currentUser;
    if (!user) {
      console.log('❌ No user signed in');
      return;
    }

    // CORRECT: September 23, 2025 was the MONDAY
    const correctMonday = new Date('2025-09-23');
    const mondayISO = correctMonday.toISOString().split('T')[0];
    
    console.log(`📅 CORRECT Monday start: ${mondayISO}`);

    // Your actual workouts from our conversation
    const actualWorkouts = {
      '2025-09-23': ['Bike'],        // Monday - Bike workout (this was actually Tuesday, but in Monday-first week it's day 1)
      '2025-09-24': ['Resistance'],  // Tuesday - 5-exercise resistance  
      '2025-09-28': ['Calves', 'Bike'] // Saturday - Calves + Bike
    };

    // Wait, let me recalculate based on your actual workout days...
    // You said Tuesday Bike, Wednesday Resistance, Sunday Calves+Bike
    // If the week starts Monday Sept 23:
    // Mon 9/23: Rest
    // Tue 9/24: Bike  
    // Wed 9/25: Resistance
    // Thu 9/26: Rest
    // Fri 9/27: Rest
    // Sat 9/28: Rest  
    // Sun 9/29: Calves + Bike

    const correctedWorkouts = {
      '2025-09-24': ['Bike'],        // Tuesday - Bike workout
      '2025-09-25': ['Resistance'],  // Wednesday - 5-exercise resistance  
      '2025-09-29': ['Calves', 'Bike'] // Sunday - Calves + Bike
    };

    // Create fresh days array starting from Monday Sept 23
    const freshDays = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(correctMonday);
      dayDate.setDate(correctMonday.getDate() + i);
      const dateISO = dayDate.toISOString().split('T')[0];
      
      const dayData = {
        dateISO,
        types: {},
        sessions: 0,
        sessionsList: [],
        comments: {}
      };
      
      // If this date has workouts, add them
      if (correctedWorkouts[dateISO]) {
        const workoutTypes = correctedWorkouts[dateISO];
        console.log(`✅ Adding workouts for ${dateISO}: ${workoutTypes.join(' + ')}`);
        
        // Set workout types
        workoutTypes.forEach(type => {
          dayData.types[type] = true;
        });
        
        // Set session metadata
        dayData.sessions = 1;
        dayData.sessionsList = [{
          sessionTypes: workoutTypes
        }];
      }
      
      freshDays.push(dayData);
    }

    // Create completely fresh weekly structure
    const freshWeeklyStructure = {
      weekly: {
        weekOfISO: mondayISO,
        weekNumber: 1,
        days: freshDays,
        benchmarks: { 
          Bike: 3, 
          "Row Machine": 3, 
          "Piano Practice": 4, 
          Mindfulness: 3,
          Resistance: 3,
          Calves: 3
        },
        customTypes: ["Bike", "Row Machine", "Piano Practice", "Mindfulness", "Resistance", "Calves"],
        typeCategories: { 
          Bike: 'Cardio', 
          "Row Machine": 'Cardio', 
          "Piano Practice": 'Skills', 
          Mindfulness: 'Mindfulness',
          Resistance: 'Resistance',
          Calves: 'Resistance'
        }
      }
    };

    console.log('📋 Corrected days structure:');
    freshDays.forEach((day, index) => {
      const dayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index];
      const workouts = Object.keys(day.types).join(' + ') || 'Rest';
      console.log(`  ${dayName} ${day.dateISO}: ${workouts}`);
    });

    // Delete the old wrong document (starting with Sunday)
    const oldWrongRef = window.appDoc(window.appDb, 'users', user.uid, 'state', '2025-09-22');
    await window.appDeleteDoc(oldWrongRef);
    console.log('🗑️ Deleted old Sunday-start document');

    // Create new correct document (starting with Monday)
    const correctWeekRef = window.appDoc(window.appDb, 'users', user.uid, 'state', mondayISO);
    await window.appSetDoc(correctWeekRef, freshWeeklyStructure);
    
    console.log('✅ Previous week FIXED with correct Monday-first structure!');
    console.log('');
    console.log('📊 Your ACTUAL workouts that week:');
    console.log('  Monday 9/23: Rest');
    console.log('  Tuesday 9/24: 🚴 Bike');
    console.log('  Wednesday 9/25: 💪 Resistance (5 exercises)');
    console.log('  Thursday 9/26: Rest');
    console.log('  Friday 9/27: Rest');
    console.log('  Saturday 9/28: Rest');
    console.log('  Sunday 9/29: 🦵 Calves + 🚴 Bike');
    console.log('');
    console.log('🔄 Please refresh the page to see the corrected data');

  } catch (error) {
    console.error('❌ Error fixing dates:', error);
  }
}

// Run the corrected fix
fixPreviousWeekCorrectDates();
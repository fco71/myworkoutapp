// Complete Previous Week Rebuild Script
// This completely deletes and recreates the previous week document with correct structure
// Run this in browser console

async function completelyRebuildPreviousWeek() {
  try {
    console.log('🚨 COMPLETELY REBUILDING previous week from scratch...');
    
    // Use the global variables that are already available
    const user = window.appAuth.currentUser;
    if (!user) {
      console.log('❌ No user signed in');
      return;
    }

    // Previous week Monday: Sept 22, 2025
    const previousWeekMonday = new Date('2025-09-22');
    const previousWeekMondayISO = previousWeekMonday.toISOString().split('T')[0];
    
    console.log(`📅 Rebuilding week starting: ${previousWeekMondayISO}`);

    // Your actual workouts from our conversation
    const actualWorkouts = {
      '2025-09-23': ['Bike'],        // Tuesday - Bike workout
      '2025-09-24': ['Resistance'],  // Wednesday - 5-exercise resistance  
      '2025-09-28': ['Calves', 'Bike'] // Sunday - Calves + Bike
    };

    // Create a completely fresh week structure using the same logic as defaultWeekly()
    const freshDays = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(previousWeekMonday);
      dayDate.setDate(previousWeekMonday.getDate() + i);
      const dateISO = dayDate.toISOString().split('T')[0];
      
      const dayData = {
        dateISO,
        types: {},
        sessions: 0,
        sessionsList: [],
        comments: {}
      };
      
      // If this date has workouts, add them
      if (actualWorkouts[dateISO]) {
        const workoutTypes = actualWorkouts[dateISO];
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
        weekOfISO: previousWeekMondayISO,
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

    console.log('📋 Fresh days structure:');
    freshDays.forEach((day, index) => {
      const dayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index];
      const workouts = Object.keys(day.types).join(' + ') || 'Rest';
      console.log(`  ${dayName} ${day.dateISO}: ${workouts}`);
    });

    // COMPLETELY REPLACE the document
    const weekRef = window.appDoc(window.appDb, 'users', user.uid, 'state', previousWeekMondayISO);
    await window.appSetDoc(weekRef, freshWeeklyStructure);
    
    console.log('✅ Previous week COMPLETELY REBUILT with correct Monday-first structure!');
    console.log('');
    console.log('📊 Your ACTUAL workouts last week:');
    console.log('  Monday 9/22: Rest');
    console.log('  Tuesday 9/23: 🚴 Bike');
    console.log('  Wednesday 9/24: 💪 Resistance (5 exercises)');
    console.log('  Thursday 9/25: Rest');
    console.log('  Friday 9/26: Rest');
    console.log('  Saturday 9/27: Rest');
    console.log('  Sunday 9/28: 🦵 Calves + 🚴 Bike');
    console.log('');
    console.log('🔄 Please refresh the page to see the corrected data');

  } catch (error) {
    console.error('❌ Error rebuilding week:', error);
  }
}

// Run the complete rebuild
completelyRebuildPreviousWeek();
// Clean Previous Week - Only Show Actually Performed Workouts
async function cleanPreviousWeek() {
  const user = window.appAuth.currentUser;
  if (!user) return console.log('Not signed in');
  
  const weekRef = window.appDoc(window.appDb, 'users', user.uid, 'state', '2025-09-22');
  const weekSnap = await window.appGetDoc(weekRef);
  
  if (!weekSnap.exists()) return console.log('No previous week data');
  
  const weekData = weekSnap.data();
  
  // Find all workout types that were actually performed (have true values)
  const actuallyPerformed = new Set();
  weekData.weekly.days.forEach(day => {
    Object.keys(day.types || {}).forEach(type => {
      if (day.types[type]) {
        actuallyPerformed.add(type);
      }
    });
  });
  
  console.log('Actually performed workout types:', Array.from(actuallyPerformed));
  
  // Update the week to only include actually performed types
  const cleanedWeekData = {
    ...weekData,
    weekly: {
      ...weekData.weekly,
      customTypes: Array.from(actuallyPerformed), // Only types that were actually done
      benchmarks: {}, // No benchmarks needed for previous weeks
      typeCategories: Object.fromEntries(
        Array.from(actuallyPerformed).map(type => [
          type, 
          type === 'Bike' ? 'Cardio' : 
          type === 'Resistance' ? 'Resistance' : 
          type === 'Calves' ? 'Resistance' : 'Other'
        ])
      )
    }
  };
  
  await window.appSetDoc(weekRef, cleanedWeekData);
  
  console.log('✅ Previous week cleaned! Only showing:', Array.from(actuallyPerformed));
  console.log('🔄 Refresh the page to see the cleaned data');
}

cleanPreviousWeek();
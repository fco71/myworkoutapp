// Fix Day Order in Existing Document
async function fixDayOrder() {
  const user = window.appAuth.currentUser;
  if (!user) return console.log('Not signed in');
  
  const weekRef = window.appDoc(window.appDb, 'users', user.uid, 'state', '2025-09-22');
  const weekSnap = await window.appGetDoc(weekRef);
  
  if (!weekSnap.exists()) return console.log('No previous week data');
  
  const weekData = weekSnap.data();
  const days = weekData.weekly.days;
  
  console.log('Current order:');
  days.forEach((day, i) => {
    const date = new Date(day.dateISO);
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    console.log(`${i}: ${day.dateISO} (${dayName})`);
  });
  
  // Find Monday (it should be index 0)
  const mondayIndex = days.findIndex(day => {
    const date = new Date(day.dateISO);
    return date.getDay() === 1; // Monday
  });
  
  if (mondayIndex === 0) {
    console.log('✅ Already correctly ordered!');
    return;
  }
  
  console.log(`📍 Monday found at index ${mondayIndex}, moving to index 0`);
  
  // Reorder: Monday first, then the rest
  const reorderedDays = [
    ...days.slice(mondayIndex), // Monday onwards
    ...days.slice(0, mondayIndex) // Everything before Monday
  ];
  
  console.log('New order:');
  reorderedDays.forEach((day, i) => {
    const date = new Date(day.dateISO);
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    console.log(`${i}: ${day.dateISO} (${dayName})`);
  });
  
  // Update the document
  const updatedData = {
    ...weekData,
    weekly: {
      ...weekData.weekly,
      days: reorderedDays
    }
  };
  
  await window.appSetDoc(weekRef, updatedData);
  console.log('✅ Day order fixed! Refresh the page.');
}

fixDayOrder();
// Simple Debug Script
async function checkDayOrder() {
  const user = window.appAuth.currentUser;
  if (!user) return console.log('Not signed in');
  
  const weekRef = window.appDoc(window.appDb, 'users', user.uid, 'state', '2025-09-22');
  const weekSnap = await window.appGetDoc(weekRef);
  
  if (!weekSnap.exists()) return console.log('No previous week data');
  
  const days = weekSnap.data().weekly.days;
  
  console.log('Days order:');
  days.forEach((day, i) => {
    const date = new Date(day.dateISO);
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    console.log(`${i}: ${day.dateISO} (${dayName})`);
  });
}

checkDayOrder();
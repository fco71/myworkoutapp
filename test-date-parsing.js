// Test Date Parsing
console.log('Testing date parsing...');

// Test the specific dates
const testDates = ['2025-09-22', '2025-09-23', '2025-09-24'];

testDates.forEach(dateISO => {
  // This is how the current code parses dates
  const date = new Date(dateISO);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const dayName1 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
  
  // Better way to parse ISO date strings (avoids timezone issues)
  const dateParts = dateISO.split('-');
  const dateUTC = new Date(Date.UTC(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2])));
  const dayOfWeekUTC = dateUTC.getDay();
  const dayName2 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeekUTC];
  
  console.log(`${dateISO}:`);
  console.log(`  new Date("${dateISO}") -> ${dayName1} (getDay: ${dayOfWeek})`);
  console.log(`  UTC parsing -> ${dayName2} (getDay: ${dayOfWeekUTC})`);
  console.log(`  Actual day: Sept ${dateParts[2]}, 2025 was a ${dateISO === '2025-09-22' ? 'Monday' : dateISO === '2025-09-23' ? 'Tuesday' : 'Wednesday'}`);
  console.log('');
});

// Test what today's date parsing shows
const today = new Date();
console.log('Today:', today.toISOString().split('T')[0]);
console.log('Today getDay():', today.getDay());
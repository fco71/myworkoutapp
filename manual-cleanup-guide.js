// DIRECT CLEANUP APPROACH
// Copy each line one by one and paste into console, then press Enter after each line

// First, let's check what Firebase objects are available
console.log('Available Firebase objects:', Object.keys(window).filter(k => k.includes('firebase') || k.includes('auth') || k.includes('db') || k.includes('app')));

// Try to find the Firebase app instance
let firebaseApp;
try {
  firebaseApp = window.firebase?.app() || window.firebaseApp;
  console.log('Firebase app found:', firebaseApp);
} catch(e) {
  console.log('No global firebase app found');
}

// Alternative: Try to access through React DevTools
let auth, db;
try {
  // Look for React Fiber
  const root = document.querySelector('#root');
  if (root && root._reactInternalFiber) {
    console.log('React Fiber found, searching for Firebase objects...');
  }
} catch(e) {
  console.log('Could not access React internals');
}

// Manual deletion approach - you'll need to identify the session IDs from your history
// and delete them one by one using the Firebase console or by finding the objects

// ALTERNATIVE SIMPLE APPROACH:
// 1. Go to Firebase Console (console.firebase.google.com)
// 2. Navigate to your project > Firestore Database
// 3. Find the users collection > your user ID > sessions
// 4. Manually delete the duplicate sessions based on the timestamps you see

console.log('If automatic detection fails, use Firebase Console at: https://console.firebase.google.com');
console.log('Navigate to: Firestore Database > users > [your-user-id] > sessions');
console.log('Delete sessions manually based on these criteria:');
console.log('- Sept 26: Delete all sessions (you did nothing)');
console.log('- Sept 28: Keep only the latest meditation session (2:38:19 PM), delete the others');
console.log('- Sept 23: Keep only the latest meditation session (10:06:11 PM), delete the others'); 
console.log('- Sept 29: Keep "Calves, Bike", delete just "Bike"');
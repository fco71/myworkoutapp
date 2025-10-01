// DEBUGGING FIREBASE ACCESS
// Run this in console to see what's available

console.log('=== DEBUGGING FIREBASE ACCESS ===');

// Check window objects
console.log('Window appAuth:', window.appAuth);
console.log('Window appDb:', window.appDb);
console.log('Window appCollection:', window.appCollection);

// Check for any firebase-related objects
const fbObjects = Object.keys(window).filter(k => 
  k.toLowerCase().includes('firebase') || 
  k.toLowerCase().includes('auth') || 
  k.toLowerCase().includes('firestore') ||
  k.toLowerCase().includes('app')
);
console.log('Firebase-related objects on window:', fbObjects);

// Try to find Firebase through modules
if (window.require) {
  try {
    console.log('Require available, trying to import Firebase...');
    const firebase = require('firebase/app');
    console.log('Firebase app:', firebase);
  } catch(e) {
    console.log('Could not require firebase:', e);
  }
}

// Look for React DevTools
const root = document.querySelector('#root');
if (root) {
  console.log('Root element found');
  console.log('React fiber keys:', Object.keys(root).filter(k => k.includes('react')));
}

// If all else fails, provide manual instructions
console.log('');
console.log('📋 MANUAL CLEANUP INSTRUCTIONS:');
console.log('1. Go to https://console.firebase.google.com');
console.log('2. Select your project');
console.log('3. Go to Firestore Database');
console.log('4. Navigate to: users > [your-user-id] > sessions');
console.log('');
console.log('🗑️ DELETE these sessions based on timestamps:');
console.log('Sept 28: Delete 12:28:46 AM and 12:28:47 AM, keep 2:38:19 PM');
console.log('Sept 23: Delete 10:06:08 PM and 10:06:09 PM, keep 10:06:11 PM');
console.log('Sept 29: Delete the "Bike" session, keep "Calves, Bike"');
console.log('Sept 26: Delete any sessions (you did nothing that day)');
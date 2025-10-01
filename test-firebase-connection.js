// Firebase Connection Test
// Run this in browser console to test Firebase connection

async function testFirebaseConnection() {
  try {
    console.log('🔥 Testing Firebase connection...');
    
    // Check if Firebase globals are available
    if (!window.appAuth) {
      console.log('❌ Firebase globals not available');
      return;
    }
    
    console.log('✅ Firebase globals available');
    console.log('Auth state:', window.appAuth.currentUser ? 'Signed in' : 'Not signed in');
    
    // Test basic Firestore access
    if (window.appAuth.currentUser) {
      const user = window.appAuth.currentUser;
      console.log('👤 User:', user.email);
      
      // Try a simple read operation
      const testRef = window.appDoc(window.appDb, 'users', user.uid, 'test', 'connection');
      console.log('📖 Attempting to read test document...');
      
      const testSnap = await window.appGetDoc(testRef);
      console.log('✅ Firestore read successful:', testSnap.exists());
      
    } else {
      console.log('🔑 Not signed in - cannot test Firestore');
    }
    
  } catch (error) {
    console.error('❌ Firebase connection error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
  }
}

// Run the test
testFirebaseConnection();
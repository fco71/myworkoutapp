// CHECK AVAILABLE FIREBASE FUNCTIONS
// First let's see what Firebase functions are actually exposed

function checkFirebaseFunctions() {
  console.log('🔍 Checking available Firebase functions...');
  
  const firebaseFunctions = Object.keys(window).filter(key => 
    key.startsWith('app') && key.toLowerCase().includes('firebase') ||
    key.startsWith('app') && (
      key.includes('Auth') || 
      key.includes('Db') || 
      key.includes('Collection') || 
      key.includes('Doc') || 
      key.includes('Add') || 
      key.includes('Set') || 
      key.includes('Get') || 
      key.includes('Delete')
    )
  );
  
  console.log('Firebase-related window objects:', firebaseFunctions);
  
  // Check specific functions we need
  const requiredFunctions = [
    'appAuth',
    'appDb', 
    'appCollection',
    'appGetDocs',
    'appAddDoc',
    'appSetDoc',
    'appDoc'
  ];
  
  console.log('\n📋 Function availability:');
  requiredFunctions.forEach(fn => {
    const available = window[fn] ? '✅' : '❌';
    console.log(`${available} ${fn}: ${typeof window[fn]}`);
  });
  
  // Also check for alternative Firebase access methods
  console.log('\n🔍 Alternative Firebase access:');
  console.log('window.firebase:', typeof window.firebase);
  console.log('window.db._delegate:', typeof window.appDb?._delegate);
  console.log('window.auth.app:', typeof window.appAuth?.app);
  
  return firebaseFunctions;
}

checkFirebaseFunctions();
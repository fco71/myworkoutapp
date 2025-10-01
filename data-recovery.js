// DATA RECOVERY CHECK - Copy and paste this into console
// Check what data is still available in weekly tracker

async function checkRemainingData() {
  console.log('🔍 Checking for remaining workout data...');
  
  const auth = window.appAuth;
  const db = window.appDb;
  
  if (!auth || !db) {
    console.error('❌ Firebase objects not found.');
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error('❌ Not signed in.');
    return;
  }
  
  console.log('User ID:', uid);
  
  try {
    const collection = window.appCollection;
    const getDocs = window.appGetDocs;
    const getDoc = window.appGetDoc;
    const doc = window.appDoc;
    
    if (!collection || !getDocs) {
      console.error('❌ Firebase functions not available');
      return;
    }
    
    // Check sessions collection (should be empty now)
    console.log('\n📊 CHECKING SESSIONS COLLECTION:');
    const sessionsRef = collection(db, 'users', uid, 'sessions');
    const sessionsSnapshot = await getDocs(sessionsRef);
    console.log(`Sessions remaining: ${sessionsSnapshot.docs.length}`);
    
    // Check weekly data collection
    console.log('\n📅 CHECKING WEEKLY DATA:');
    const weeklyRef = collection(db, 'users', uid, 'weeklyData');
    const weeklySnapshot = await getDocs(weeklyRef);
    console.log(`Weekly data documents: ${weeklySnapshot.docs.length}`);
    
    if (weeklySnapshot.docs.length > 0) {
      console.log('\n✅ FOUND WEEKLY DATA - This might contain your workout history!');
      weeklySnapshot.docs.forEach(weekDoc => {
        const data = weekDoc.data();
        console.log(`Week: ${weekDoc.id}`);
        console.log('Data:', data);
        console.log('---');
      });
    }
    
    // Check user profile/settings
    console.log('\n👤 CHECKING USER PROFILE:');
    try {
      if (getDoc) {
        const userDocRef = doc(db, 'users', uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          console.log('User profile data:', userDocSnap.data());
        } else {
          console.log('No user profile found');
        }
      }
    } catch (e) {
      console.log('Could not check user profile:', e);
    }
    
    // Check favorites collection  
    console.log('\n⭐ CHECKING FAVORITES:');
    const favoritesRef = collection(db, 'users', uid, 'favorites');
    const favoritesSnapshot = await getDocs(favoritesRef);
    console.log(`Favorites: ${favoritesSnapshot.docs.length}`);
    
    if (favoritesSnapshot.docs.length > 0) {
      console.log('Favorites data:');
      favoritesSnapshot.docs.forEach(favDoc => {
        console.log(`- ${favDoc.id}:`, favDoc.data());
      });
    }
    
    console.log('\n🛠️ RECOVERY OPTIONS:');
    console.log('1. Check Firebase Console for any recent backups');
    console.log('2. If you have weekly tracker data, we can recreate sessions from that');
    console.log('3. Manually recreate the legitimate sessions you remember');
    console.log('4. Check if you have any local app cache that might contain data');
    
  } catch (error) {
    console.error('❌ Error checking data:', error);
  }
}

// Run the data check
checkRemainingData();
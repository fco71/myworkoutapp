// Initialize Firebase with your config
const firebaseConfig = {
    apiKey: "AIzaSyB7OR5aBzZ8N4d7BaB_HlZoFfWGegG7Fvg",
    authDomain: "fcoworkout.firebaseapp.com",
    projectId: "fcoworkout",
    storageBucket: "fcoworkout.firebasestorage.app",
    messagingSenderId: "939615720328",
    appId: "1:939615720328:web:d60687e4e617d0d3b5203d"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Initialize services
const auth = firebase.auth();

// Initialize Firestore
const db = firebase.firestore();

// Temporarily disabled persistence to fix CORS issues
// For the compatibility version, we'll use enablePersistence directly
// but with a try-catch to handle any errors
// db.enablePersistence({ synchronizeTabs: true })
//   .catch((err) => {
//       if (err.code === 'failed-precondition') {
//           // Multiple tabs open, persistence can only be enabled in one tab at a time.
//           console.warn('Firebase offline persistence failed: Multiple tabs open. Offline data will only be available in one tab at a time.');
//       } else if (err.code === 'unimplemented') {
//           // The current browser does not support all of the features required
//           console.warn('Firebase offline persistence is not supported in this browser.');
//       } else {
//           console.error('Firebase offline persistence error:', err);
//       }
//   });


// Collections
const exercisesRef = db.collection('exercises');
const workoutTemplatesRef = db.collection('workoutTemplates');
const workoutsRef = db.collection('workouts');

// Helper function to get a reference to a user document
const getUserDoc = (userId) => db.collection('users').doc(userId);

// Auth functions
const signInWithEmail = async (email, password) => {
    try {
        const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
        // Update last login time
        await getUserDoc(userCredential.user.uid).update({
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        });
        return userCredential.user;
    } catch (error) {
        console.error("Error signing in:", error);
        throw error;
    }
};

const signUpWithEmail = async (email, password, displayName = '') => {
    try {
        const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
        // Create user document in Firestore
        await getUserDoc(userCredential.user.uid).set({
            email: userCredential.user.email,
            displayName: displayName || email.split('@')[0],
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        });
        return userCredential.user;
    } catch (error) {
        console.error("Error signing up:", error);
        throw error;
    }
};

const signInWithGoogle = async () => {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await firebase.auth().signInWithPopup(provider);
        const user = result.user;
        const userDoc = await getUserDoc(user.uid).get();
        
        if (!userDoc.exists) {
            // Create user document if it doesn't exist
            await getUserDoc(user.uid).set({
                email: user.email,
                displayName: user.displayName || user.email.split('@')[0],
                photoURL: user.photoURL || '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            // Update last login time
            await getUserDoc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        return user;
    } catch (error) {
        console.error("Error signing in with Google:", error);
        throw error;
    }
};

const signOut = async () => {
    try {
        await firebase.auth().signOut();
    } catch (error) {
        console.error("Error signing out:", error);
        throw error;
    }
};

// Get current user
const getCurrentUser = () => {
    return firebase.auth().currentUser;
};

// Auth state observer
const onAuthStateChanged = (callback) => {
    return firebase.auth().onAuthStateChanged(callback);
};

// Helper to get user data
const getUserData = async (userId) => {
    const userDoc = await getUserDoc(userId).get();
    return userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
};

// Make functions available globally
window.firebaseAuth = {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
    getCurrentUser,
    onAuthStateChanged,
    getUserData,
    db,
    auth: firebase.auth()
};

import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB7OR5aBzZ8N4d7BaB_HlZoFfWGegG7Fvg",
  authDomain: "fcoworkout.firebaseapp.com",
  projectId: "fcoworkout",
  storageBucket: "fcoworkout.firebasestorage.app",
  messagingSenderId: "939615720328",
  appId: "1:939615720328:web:d60687e4e617d0d3b5203d",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);



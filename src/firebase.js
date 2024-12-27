// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { getFirestore } from 'firebase/firestore';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: 'AIzaSyCNU4GgTYtSsCAPVvwtpO2MENF98rhgbeA',
  authDomain: 'peer-review-ed29f.firebaseapp.com',
  projectId: 'peer-review-ed29f',
  storageBucket: 'peer-review-ed29f.firebasestorage.app',
  messagingSenderId: '845630330923',
  appId: '1:845630330923:web:b05718fd0e9a10257c326e',
  measurementId: 'G-HGS4KMXY5C',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const db = getFirestore(app);

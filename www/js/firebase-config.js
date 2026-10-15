// Firebase project used by the web version (see cloud.js). These values identify the project;
// they aren't secrets — access is controlled by the group login and firestore.rules.
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDjcK8ynz_lG_tBvvt6EfCTiJTO3c8ohlw',
  authDomain: 'shared-badminton.firebaseapp.com',
  projectId: 'shared-badminton',
  storageBucket: 'shared-badminton.firebasestorage.app',
  messagingSenderId: '711180036682',
  appId: '1:711180036682:web:dec4e0957735be696c14b3'
};

// The one shared account the whole group signs in with; people only type its password.
window.FIREBASE_GROUP_EMAIL = 'group@shared-badminton.firebaseapp.com';

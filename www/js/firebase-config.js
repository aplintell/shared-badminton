// Firebase project used by the web version (see cloud.js). These values identify the project;
// they aren't secrets — access is controlled by the group login and firestore.rules.
// TODO: fill in from Firebase console > Project settings > Your apps (web app) once the
// shared-badminton Firebase project exists. Until then (FIREBASE_CONFIG unset) the web app
// keeps its data in each browser's own storage, like the packaged Android app.
// window.FIREBASE_CONFIG = {
//   apiKey: '',
//   authDomain: 'shared-badminton.firebaseapp.com',
//   projectId: 'shared-badminton',
//   storageBucket: 'shared-badminton.firebasestorage.app',
//   messagingSenderId: '',
//   appId: ''
// };

// The one shared account the whole group signs in with; people only type its password.
window.FIREBASE_GROUP_EMAIL = 'group@shared-badminton.firebaseapp.com';

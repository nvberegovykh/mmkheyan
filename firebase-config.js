/* Firebase Web SDK config — these values are public identifiers by design
 * (not secrets). Actual write access is protected by Firestore Security
 * Rules (only authenticated users can write) and by Firebase Authentication
 * (only the admin account can sign in). See admin/admin.js for the auth gate. */
/* global window */
(function () {
    window.FIREBASE_CONFIG = {
        apiKey: "AIzaSyBazvD6hXSQv30endtGZ31BQf1xzD3S70Y",
        authDomain: "mmkheyan-gallery.firebaseapp.com",
        projectId: "mmkheyan-gallery",
        storageBucket: "mmkheyan-gallery.firebasestorage.app",
        messagingSenderId: "607661830818",
        appId: "1:607661830818:web:1fafe5b441b989da02ddfb"
    };

    // Cloudinary holds the actual image files (Firebase Storage now requires
    // a paid Blaze plan even for small usage, so we split responsibilities:
    // Firestore = metadata + auth gate, Cloudinary = free image hosting/CDN).
    window.CLOUDINARY_CONFIG = {
        cloudName: "ttqojuw8",
        uploadPreset: "mmkheyan_unsigned",
        folder: "mmkheyan"
    };
})();

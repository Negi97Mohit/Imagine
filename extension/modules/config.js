// ---- Firebase & Firestore Configuration ----
// Supports both Firestore REST API for Community Presets & Shared Redesigns,
// and Firebase Realtime Database for real-time asset bindings.

const LOCKED_IMAGE_CONFIG = {
  FIREBASE_PROJECT_ID: "wallofshame-500ef",
  FIREBASE_DATABASE_URL: "https://wallofshame-500ef-default-rtdb.firebaseio.com",
  FIRESTORE_BASE_URL: "https://firestore.googleapis.com/v1/projects/wallofshame-500ef/databases/(default)/documents",

  // Collections
  COLLECTIONS: {
    PRESETS: "redesign_presets",
    REDESIGNS: "redesigns",
    BINDINGS: "bindings",
  },
};

if (typeof globalThis !== "undefined") {
  globalThis.LOCKED_IMAGE_CONFIG = LOCKED_IMAGE_CONFIG;
}



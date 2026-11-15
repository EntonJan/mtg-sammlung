import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

// Öffentliche Web-Konfiguration (kein Geheimnis – der Schutz läuft über die Firestore-Regeln)
const firebaseConfig = {
  apiKey: 'AIzaSyBAIGNBrqlqezkmZXD0y7hWCGFPbqr7DuU',
  authDomain: 'mtg-sammlung.firebaseapp.com',
  projectId: 'mtg-sammlung',
  storageBucket: 'mtg-sammlung.firebasestorage.app',
  messagingSenderId: '313103394143',
  appId: '1:313103394143:web:b448e7777db6b9f4e7c2ea',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

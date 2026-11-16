export const onAuthStateChanged = (_a, cb) => { setTimeout(() => cb({ uid: 'demo', email: 'demo@mtg-sammlung', displayName: 'Demo' }), 0); return () => {} }
export const signInWithPopup = async () => {}
export const signOut = async () => {}
export const getAuth = () => ({})
export class GoogleAuthProvider {}
export const EmailAuthProvider = { credential: () => ({}) }
export const linkWithCredential = async () => {}
export const reauthenticateWithPopup = async () => {}
export const sendPasswordResetEmail = async () => {}
export const signInWithEmailAndPassword = async () => {}
export const updatePassword = async () => {}
export const signInWithCredential = async () => {}

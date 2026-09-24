// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth} from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB3M0i_CqNeIaU-8Yj6Hzknd15DSRWUFVI",
  authDomain: "pi-web-34b95.firebaseapp.com",
  projectId: "pi-web-34b95",
  storageBucket: "pi-web-34b95.firebasestorage.app",
  messagingSenderId: "48060929766",
  appId: "1:48060929766:web:dc6b666f5f7c90b9e84d27",
  measurementId: "G-9WEM8LDMVF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export const auth = getAuth(app);
export default app;
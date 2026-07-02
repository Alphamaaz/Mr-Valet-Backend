import fs from "fs";
import path from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

let firebaseApp = null;

function parseServiceAccount() {
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (filePath) {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  }

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    return JSON.parse(json);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

export function getFirebaseMessaging() {
  if (firebaseApp) {
    return getMessaging(firebaseApp);
  }

  const existingApp = getApps()[0];
  if (existingApp) {
    firebaseApp = existingApp;
    return getMessaging(firebaseApp);
  }

  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) {
    return null;
  }

  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
  });

  return getMessaging(firebaseApp);
}

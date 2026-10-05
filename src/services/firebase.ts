import { initializeApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

import { AuthError } from '@/services/authErrors'

// The Firebase web config is public by design (it names the project); access is enforced by
// Firebase Auth and the backend. Values come from .env.local (see .env.example).
export function readFirebaseConfig(env: Record<string, string | undefined> = import.meta.env) {
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new AuthError('not-configured', `Firebase config missing: ${missing.join(', ')}`)
  }

  return config as Record<keyof typeof config, string>
}

let auth: Auth | null = null

// Created on first use, so importing the app (or a test) never needs Firebase config.
export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(initializeApp(readFirebaseConfig()))
  }

  return auth
}

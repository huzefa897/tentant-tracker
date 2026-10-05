import { describe, expect, it } from 'vitest'

import { AuthError } from '@/services/authErrors'
import { readFirebaseConfig } from '@/services/firebase'

const env = {
  VITE_FIREBASE_API_KEY: 'api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'example',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
}

describe('readFirebaseConfig', () => {
  it('reads the web app config', () => {
    expect(readFirebaseConfig(env)).toEqual({
      apiKey: 'api-key',
      authDomain: 'example.firebaseapp.com',
      projectId: 'example',
      appId: '1:2:web:3',
    })
  })

  it('names every missing value as a not-configured error', () => {
    const error = (() => {
      try {
        readFirebaseConfig({ ...env, VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_APP_ID: undefined })
      } catch (err) {
        return err
      }
    })()

    expect(error).toBeInstanceOf(AuthError)
    expect(error).toMatchObject({
      code: 'not-configured',
      message: 'Firebase config missing: apiKey, appId',
    })
  })
})

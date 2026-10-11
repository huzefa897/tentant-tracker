import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type { AppIdentity, PropertyAccess, PropertyRole } from '@/types/access'

const ROLES: readonly PropertyRole[] = ['owner', 'manager']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePropertyAccess(value: unknown): PropertyAccess {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !ROLES.includes(value.role as PropertyRole)
  ) {
    throw new ApiError('invalid-response', 'Unexpected property in /me response')
  }

  return { id: value.id, name: value.name, role: value.role as PropertyRole }
}

// Validates the response rather than trusting its shape: a malformed answer is an error, never
// "no properties".
export function parseAppIdentity(data: unknown): AppIdentity {
  if (
    !isRecord(data) ||
    typeof data.id !== 'number' ||
    typeof data.name !== 'string' ||
    typeof data.phoneNumber !== 'string' ||
    !Array.isArray(data.properties)
  ) {
    throw new ApiError('invalid-response', 'Unexpected /me response')
  }

  return {
    id: data.id,
    name: data.name,
    phoneNumber: data.phoneNumber,
    properties: data.properties.map(parsePropertyAccess),
  }
}

export const accessService = {
  async getMe(): Promise<AppIdentity> {
    let data: unknown

    try {
      data = (await api.get('/me/')).data
    } catch (error) {
      throw toApiError(error)
    }

    return parseAppIdentity(data)
  },
}

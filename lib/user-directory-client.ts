'use client'

import type { User } from '@/types'

let directory: User[] = []
let hydration: Promise<User[]> | null = null

export function getCachedUserDirectory(): User[] {
  return directory
}

export async function hydrateUserDirectory(force = false): Promise<User[]> {
  if (!force && hydration) return hydration
  hydration = fetch('/api/users/directory', { cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(payload?.users)) throw new Error(payload?.error || 'Falha ao carregar usuarios.')
      directory = payload.users as User[]
      return directory
    })
    .catch((error) => {
      hydration = null
      throw error
    })
  return hydration
}

export function setCachedUserDirectory(users: User[]): void {
  directory = users.slice()
  hydration = Promise.resolve(directory)
}

export function clearCachedUserDirectory(): void {
  directory = []
  hydration = null
}

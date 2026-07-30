'use client'

import type { TravelerPortalOverview, TravelerTrip } from '@/lib/traveler/types'

const DATABASE_NAME = 'bbt-traveler-offline-v1'
const DATABASE_VERSION = 1
const STORE_NAME = 'snapshots'
const SNAPSHOT_KEY = 'current'

export interface TravelerOfflineIdentity {
  tenantId: string
  userId: string
}

export interface TravelerOfflineSnapshot {
  ownerKey: string
  savedAt: string
  overview: TravelerPortalOverview
}

export function travelerOfflineOwnerKey(identity: TravelerOfflineIdentity): string {
  return `${identity.tenantId.trim()}:${identity.userId.trim()}`
}

export async function saveTravelerOverviewOffline(
  identity: TravelerOfflineIdentity,
  overview: TravelerPortalOverview,
): Promise<TravelerOfflineSnapshot> {
  const snapshot: TravelerOfflineSnapshot = {
    ownerKey: travelerOfflineOwnerKey(identity),
    savedAt: new Date().toISOString(),
    overview: sanitizeTravelerOverviewForOffline(overview),
  }
  const database = await openDatabase()
  await requestAsPromise(
    database
      .transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)
      .put(snapshot, SNAPSHOT_KEY),
  )
  database.close()
  return snapshot
}

export async function loadTravelerOverviewOffline(
  identity: TravelerOfflineIdentity,
): Promise<TravelerOfflineSnapshot | null> {
  if (!supportsIndexedDb()) return null
  const database = await openDatabase()
  const snapshot = await requestAsPromise<TravelerOfflineSnapshot | undefined>(
    database
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .get(SNAPSHOT_KEY),
  )
  database.close()
  if (!snapshot || snapshot.ownerKey !== travelerOfflineOwnerKey(identity)) return null
  return snapshot
}

export async function clearTravelerOverviewOffline(): Promise<void> {
  if (!supportsIndexedDb()) return
  const database = await openDatabase()
  await requestAsPromise(
    database
      .transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)
      .delete(SNAPSHOT_KEY),
  )
  database.close()
}

export async function clearTravelerOfflineDatabase(): Promise<void> {
  if (!supportsIndexedDb()) return
  await new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error('Falha ao limpar dados offline.'))
    request.onblocked = () => resolve()
  })
}

export function sanitizeTravelerOverviewForOffline(
  overview: TravelerPortalOverview,
): TravelerPortalOverview {
  return {
    generatedAt: limitedText(overview.generatedAt, 40),
    identitySource: overview.identitySource,
    profiles: overview.profiles.slice(0, 10).map((profile) => ({
      id: limitedText(profile.id, 100),
      identificationCode: limitedText(profile.identificationCode, 100),
      name: limitedText(profile.name, 200),
      documentMasked: nullableText(profile.documentMasked, 40),
      email: nullableText(profile.email, 254),
      phone: nullableText(profile.phone, 40),
      jobTitle: nullableText(profile.jobTitle, 150),
      department: nullableText(profile.department, 150),
      costCenter: nullableText(profile.costCenter, 150),
      companyId: limitedText(profile.companyId, 100),
      companyName: limitedText(profile.companyName, 200),
    })),
    upcomingTrips: overview.upcomingTrips.slice(0, 100).map(sanitizeTrip),
    pastTrips: overview.pastTrips.slice(0, 100).map(sanitizeTrip),
    support: {
      label: limitedText(overview.support.label, 160),
      phone: nullableText(overview.support.phone, 40),
      email: nullableText(overview.support.email, 254),
      emergencyPhone: nullableText(overview.support.emergencyPhone, 40),
    },
  }
}

function sanitizeTrip(trip: TravelerTrip): TravelerTrip {
  return {
    id: limitedText(trip.id, 140),
    demandId: nullableText(trip.demandId, 100),
    demandNumber: nullableText(trip.demandNumber, 100),
    companyId: limitedText(trip.companyId, 100),
    companyName: limitedText(trip.companyName, 200),
    destination: nullableText(trip.destination, 200),
    startDate: nullableText(trip.startDate, 40),
    endDate: nullableText(trip.endDate, 40),
    status: limitedText(trip.status, 100),
    serviceType: limitedText(trip.serviceType, 100),
    updatedAt: limitedText(trip.updatedAt, 40),
    reservations: trip.reservations.slice(0, 30).map((reservation) => ({
      id: limitedText(reservation.id, 100),
      serviceType: limitedText(reservation.serviceType, 100),
      provider: limitedText(reservation.provider, 160),
      reference: nullableText(reservation.reference, 160),
      status: limitedText(reservation.status, 100),
      startAt: nullableText(reservation.startAt, 40),
      endAt: nullableText(reservation.endAt, 40),
      origin: nullableText(reservation.origin, 160),
      destination: nullableText(reservation.destination, 160),
      flightNumber: nullableText(reservation.flightNumber, 80),
      terminal: nullableText(reservation.terminal, 80),
      gate: nullableText(reservation.gate, 80),
      hotelName: nullableText(reservation.hotelName, 200),
      address: nullableText(reservation.address, 300),
      checkInUrl: safeHttpsUrl(reservation.checkInUrl),
    })),
    vouchers: trip.vouchers.slice(0, 30).map((voucher) => ({
      id: limitedText(voucher.id, 100),
      code: limitedText(voucher.code, 160),
      status: limitedText(voucher.status, 100),
      issuedAt: nullableText(voucher.issuedAt, 40),
      hasFile: Boolean(voucher.hasFile),
      downloadUrl: safeInternalDownloadUrl(voucher.downloadUrl),
    })),
    updates: trip.updates.slice(0, 20).map((update) => ({
      id: limitedText(update.id, 100),
      type: limitedText(update.type, 100),
      fromStatus: nullableText(update.fromStatus, 100),
      toStatus: nullableText(update.toStatus, 100),
      createdAt: limitedText(update.createdAt, 40),
    })),
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!supportsIndexedDb()) return Promise.reject(new Error('Armazenamento offline indisponivel.'))
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Falha ao abrir armazenamento offline.'))
    request.onblocked = () => reject(new Error('Armazenamento offline temporariamente bloqueado.'))
  })
}

function requestAsPromise<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Falha no armazenamento offline.'))
  })
}

function supportsIndexedDb(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

function limitedText(value: string, maxLength: number): string {
  return String(value || '').trim().slice(0, maxLength)
}

function nullableText(value: string | null, maxLength: number): string | null {
  if (!value) return null
  return limitedText(value, maxLength) || null
}

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function safeInternalDownloadUrl(value: string | null): string | null {
  if (!value) return null
  return /^\/api\/traveler\/vouchers\/[A-Za-z0-9_-]{1,100}\/download$/.test(value)
    ? value
    : null
}

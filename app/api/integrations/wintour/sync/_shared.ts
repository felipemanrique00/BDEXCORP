import { NextResponse } from 'next/server'

import { governanceErrorResponse } from '@/lib/server/governance-api'
import { WintourSyncError } from '@/lib/server/wintour-sync-service'

export const WINTOUR_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, private',
  Pragma: 'no-cache',
} as const

export function wintourSyncJson(
  body: Record<string, unknown>,
  requestId: string,
  init: { status?: number } = {},
) {
  return NextResponse.json(body, {
    status: init.status,
    headers: {
      ...WINTOUR_NO_STORE_HEADERS,
      'X-Request-Id': requestId,
    },
  })
}

export function wintourSyncErrorResponse(error: unknown, requestId: string) {
  if (error instanceof WintourSyncError) {
    return wintourSyncJson(
      { ok: false, code: error.code, error: error.message, requestId },
      requestId,
      { status: error.status },
    )
  }
  const response = governanceErrorResponse(error, requestId)
  response.headers.set('Cache-Control', WINTOUR_NO_STORE_HEADERS['Cache-Control'])
  response.headers.set('Pragma', WINTOUR_NO_STORE_HEADERS.Pragma)
  return response
}

export function wintourGuardResponse(response: NextResponse) {
  response.headers.set('Cache-Control', WINTOUR_NO_STORE_HEADERS['Cache-Control'])
  response.headers.set('Pragma', WINTOUR_NO_STORE_HEADERS.Pragma)
  return response
}

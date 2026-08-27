import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { getWintourSyncJobArtifact } from '@/lib/server/wintour-sync-service'

import { wintourGuardResponse, wintourSyncErrorResponse } from '../../../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ jobId: z.string().uuid() }).strict()

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    rateLimit: { key: 'wintour-sync:download', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return wintourGuardResponse(guard.response)

  try {
    const { jobId } = paramsSchema.parse(await context.params)
    const artifact = await getWintourSyncJobArtifact(guard.principal!, { jobId })
    const filename = safeFilename(artifact.filename, jobId)
    return new NextResponse(Uint8Array.from(artifact.bytes), {
      headers: {
        'Content-Type': 'application/xml; charset=iso-8859-1',
        'Content-Length': String(artifact.bytes.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, private',
        Pragma: 'no-cache',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': guard.requestId,
      },
    })
  } catch (error) {
    return wintourSyncErrorResponse(error, guard.requestId)
  }
}

function safeFilename(value: string, jobId: string): string {
  const filename = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return filename.toLowerCase().endsWith('.xml') ? filename : `wintour-${jobId}.xml`
}

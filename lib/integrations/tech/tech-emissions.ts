import { z } from 'zod'

import { techRequest } from '@/lib/integrations/tech/tech-client'
import {
  getTechConfig,
  techMissingReportsConfig,
  techReportsConfigured,
} from '@/lib/integrations/tech/tech-config'
import {
  buildTechEmissionsReport,
  normalizeTechEmission,
  type TechEmissionQuery,
} from '@/lib/integrations/tech/tech-emissions-normalizer'
import { TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { requestId } from '@/lib/integrations/tech/tech-idempotency'
import { logTechIntegration } from '@/lib/integrations/tech/tech-logger'
import type { TechEmissionsReport } from '@/lib/integrations/tech/tech-emissions-types'

export { normalizeTechEmission } from '@/lib/integrations/tech/tech-emissions-normalizer'
export type { TechEmissionQuery } from '@/lib/integrations/tech/tech-emissions-normalizer'

const techEmissionsApiSchema = z.object({
  Emissoes: z.array(z.record(z.unknown())).default([]),
  Erro: z.unknown().nullable().optional(),
}).passthrough()

export async function queryTechEmissions(query: TechEmissionQuery): Promise<TechEmissionsReport> {
  const config = getTechConfig()
  if (!techReportsConfigured(config)) {
    throw new TechIntegrationError(`Relatórios Tech Travel não configurados: ${techMissingReportsConfig(config).join(', ')}.`, {
      status: 503,
      code: 'TECH_REPORTS_NOT_CONFIGURED',
    })
  }

  const response = await techRequest<unknown>(
    '/Emissao',
    {
      method: 'POST',
      body: {
        Key: config.reportsKey,
        DataInicio: isoToBrazilianDate(query.startDate),
        DataFim: isoToBrazilianDate(query.endDate),
      },
      requestId: requestId('tech_emissions_report'),
    },
    { ...config, baseUrl: config.reportsBaseUrl },
  )

  const parsed = techEmissionsApiSchema.safeParse(response.data)
  if (!parsed.success) {
    throw new TechIntegrationError('A Tech Travel retornou um formato de emissões não reconhecido.', {
      code: 'TECH_REPORTS_INVALID_RESPONSE',
      details: { issues: parsed.error.issues },
    })
  }

  const emissions = parsed.data.Emissoes.map(normalizeTechEmission)
  const report = buildTechEmissionsReport(query, emissions)
  await logTechIntegration({
    action: 'emissions-report',
    status: 'success',
    message: `Relatório Tech Travel consultado com ${report.total} emissão(ões).`,
    endpoint: '/Emissao',
    durationMs: response.durationMs,
    metadata: {
      startDate: query.startDate,
      endDate: query.endDate,
      total: report.total,
      clients: Object.keys(report.byClient).length,
    },
  })
  return report
}

function isoToBrazilianDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

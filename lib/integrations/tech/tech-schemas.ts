import { z } from 'zod'

export const travelServiceSchema = z.enum(['aereo', 'hotelaria', 'locacao', 'pacotes', 'lazer', 'transfer', 'seguro', 'rodoviario'])

export const travelQuoteRequestSchema = z.object({
  service: travelServiceSchema,
  empresaId: z.string().optional(),
  providerCompanyId: z.union([z.string(), z.number()]).nullable().optional(),
  origem: z.string().optional(),
  destino: z.string().optional(),
  origemIata: z.string().optional(),
  destinoIata: z.string().optional(),
  idCidade: z.union([z.string(), z.number()]).nullable().optional(),
  dataInicio: z.string().optional(),
  dataFim: z.string().nullable().optional(),
  adultos: z.coerce.number().int().min(0).max(9).optional(),
  criancas: z.coerce.number().int().min(0).max(9).optional(),
  bebes: z.coerce.number().int().min(0).max(9).optional(),
  idadesCriancas: z.array(z.coerce.number().int().min(0).max(17)).optional(),
  sistemas: z.array(z.string()).optional(),
  hotelSuppliers: z.array(z.string()).optional(),
  idPolitica: z.union([z.string(), z.number()]).nullable().optional(),
  idOs: z.union([z.string(), z.number()]).nullable().optional(),
  buscarCasada: z.boolean().optional(),
  apenasVoosDiretos: z.boolean().optional(),
  apenasTarifasComBagagem: z.boolean().optional(),
  apenasTarifasMaisBaratas: z.boolean().optional(),
  raw: z.record(z.unknown()).optional(),
})

export const citySearchSchema = z.object({
  query: z.string().min(1),
  service: travelServiceSchema.default('hotelaria'),
  providerCompanyId: z.union([z.string(), z.number()]).nullable().optional(),
})

const travelerInputSchema = z.object({
  nome: z.string().min(1),
  sobrenome: z.string().optional(),
  genero: z.string().optional(),
  dataNascimento: z.string().optional(),
  cpf: z.string().optional(),
  tipo: z.enum(['ADT', 'CHD', 'INF']).optional(),
  idViajante: z.union([z.string(), z.number()]).nullable().optional(),
  idFuncionario: z.union([z.string(), z.number()]).nullable().optional(),
  idPolitica: z.union([z.string(), z.number()]).nullable().optional(),
  idCentroCusto: z.union([z.string(), z.number()]).nullable().optional(),
  email: z.string().optional(),
  telefone: z.string().optional(),
})

export const travelReservationRequestSchema = z.object({
  service: travelServiceSchema,
  quoteId: z.string().optional(),
  optionId: z.string().optional(),
  idOs: z.union([z.string(), z.number()]).nullable().optional(),
  localizador: z.string().optional(),
  sistema: z.string().optional(),
  tipoSistema: z.string().optional(),
  chaveConsulta: z.string().optional(),
  travelers: z.array(travelerInputSchema).optional(),
  contatoReserva: z.record(z.unknown()).optional(),
  payment: z.record(z.unknown()).optional(),
  payload: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().optional(),
  confirmed: z.boolean().optional(),
})

export const statusRequestSchema = z.object({
  idOs: z.union([z.string(), z.number()]),
  providerCompanyId: z.union([z.string(), z.number()]).nullable().optional(),
})

export const reservationLookupSchema = z.object({
  idOs: z.union([z.string(), z.number()]),
  localizador: z.string(),
  sistema: z.string(),
  tipoSistema: z.string(),
  chaveConsulta: z.string(),
  providerCompanyId: z.union([z.string(), z.number()]).nullable().optional(),
})

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato YYYY-MM-DD.')

export const techEmissionQuerySchema = z.object({
  startDate: isoDateSchema,
  endDate: isoDateSchema,
}).superRefine((value, context) => {
  const start = new Date(`${value.startDate}T00:00:00Z`)
  const end = new Date(`${value.endDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Período inválido.' })
    return
  }
  if (end < start) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A data final deve ser igual ou posterior à inicial.', path: ['endDate'] })
    return
  }
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (days > 366) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Consulte no máximo 366 dias por vez.', path: ['endDate'] })
  }
})

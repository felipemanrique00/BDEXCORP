import { todayISODate } from '@/lib/date'
// ============================================================
// SCHEMAS DE VALIDAÇÃO — Zod
// Toda entrada de dado (formulário, importação, parser) é validada
// com estes schemas antes de virar entidade do sistema.
// ============================================================

import { z } from 'zod'
import {
  normalizarCPF, normalizarCNPJ, normalizarTelefone, normalizarEmail,
  normalizarNome, normalizarData, normalizarValor, normalizarTexto,
  normalizarTipoServico, normalizarStatusEmissao,
} from './normalizers'

// === Helpers ===

const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em ISO YYYY-MM-DD')

const cpfOpcional = z.string().optional().transform((v) => v ? normalizarCPF(v) : '')
const cnpjOpcional = z.string().optional().transform((v) => v ? normalizarCNPJ(v) : '')
const telefoneOpcional = z.string().optional().transform((v) => v ? normalizarTelefone(v) : '')
const emailOpcional = z.string().optional().transform((v) => v ? normalizarEmail(v) : '')

const valorMonetario = z.union([z.number(), z.string()])
  .transform((v) => normalizarValor(v))
  .pipe(z.number().min(0, 'Valor não pode ser negativo'))

const valorMonetarioOpcional = z.union([z.number(), z.string(), z.undefined(), z.null()])
  .transform((v) => v === undefined || v === null ? 0 : normalizarValor(v))
  .pipe(z.number().min(0))

// === Schemas de domínio ===

export const empresaSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(2, 'Nome muito curto').transform((v) => normalizarTexto(v)),
  cnpj: cnpjOpcional,
  codigo_cliente: z.string().optional().transform((v) => v ? v.toUpperCase().trim() : ''),
  endereco: z.string().optional().transform((v) => v ? normalizarTexto(v) : ''),
  responsavel: z.string().optional().transform((v) => v ? normalizarNome(v) : ''),
  email_responsavel: emailOpcional,
  telefone: telefoneOpcional,
  centro_custo_padrao: z.string().optional().transform((v) => v ? normalizarTexto(v, { upper: true }) : ''),
  ativa: z.boolean().default(true),
})

export const funcionarioSchema = z.object({
  id: z.string().optional(),
  empresa_id: z.string().min(1, 'Empresa obrigatória'),
  nome: z.string().min(2, 'Nome obrigatório').transform(normalizarNome),
  cpf: cpfOpcional,
  email: emailOpcional,
  telefone: telefoneOpcional,
  cargo: z.string().optional().transform((v) => v ? normalizarTexto(v) : ''),
  centro_custo: z.string().optional().transform((v) => v ? normalizarTexto(v, { upper: true }) : ''),
  data_nascimento: z.string().optional().transform((v) => v ? normalizarData(v) : ''),
  ativo: z.boolean().default(true),
}).refine((d) => d.cpf === '' || d.cpf.length === 11, {
  message: 'CPF inválido (não passou na verificação dos dígitos)',
  path: ['cpf'],
})

export const detalhesHotelSchema = z.object({
  hotel_id: z.number().optional(),
  hotel_nome: z.string().optional().transform((v) => v ? normalizarTexto(v) : ''),
  cidade: z.string().optional().transform((v) => v ? normalizarTexto(v) : ''),
  uf: z.string().length(2).optional(),
  data_checkin: z.string().optional().transform((v) => v ? normalizarData(v) : ''),
  data_checkout: z.string().optional().transform((v) => v ? normalizarData(v) : ''),
  num_hospedes: z.number().int().min(1).max(20).default(1),
  tipo_apto: z.enum(['SGL', 'DBL', 'TPL', 'QUAD']).optional(),
  noites: z.number().int().min(1).optional(),
  localizador: z.string().optional(),
}).refine((d) => {
  if (d.data_checkin && d.data_checkout) {
    return d.data_checkout > d.data_checkin
  }
  return true
}, { message: 'Data de checkout deve ser depois do checkin', path: ['data_checkout'] })

export const detalhesAereoSchema = z.object({
  trip_type: z.enum(['one_way', 'round_trip', 'multi_city']).optional(),
  cia_aerea: z.string().optional(),
  origem: z.string().optional(),
  destino: z.string().optional(),
  data_ida: z.string().optional().transform((v) => v ? normalizarData(v) : ''),
  data_volta: z.string().optional().transform((v) => v ? normalizarData(v) : ''),
  localizador: z.string().optional(),
  numero_voo: z.string().optional(),
  classe: z.enum(['Econômica', 'Econômica Premium', 'Executiva', 'Primeira']).optional(),
  internacional: z.boolean().optional(),
  preferred_airlines: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  baggage_pieces: z.number().int().min(0).max(10).optional(),
  flexible_dates: z.boolean().optional(),
  flexible_times: z.boolean().optional(),
  passengers: z.array(z.object({
    employee_id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(2).max(300),
  }).strict()).min(1).max(100).optional(),
  trechos: z.array(z.object({
    sequence: z.number().int().positive(),
    direction: z.enum(['outbound', 'return', 'multi_city']).optional(),
    origin: z.string().trim().min(3).max(160).regex(
      /^[A-Za-z]{3}(?:\s*[-\u2013\u2014]\s*.+)?$/,
      'Informe a origem como IATA ou IATA - nome (ex.: REC - Recife).',
    ),
    destination: z.string().trim().min(3).max(160).regex(
      /^[A-Za-z]{3}(?:\s*[-\u2013\u2014]\s*.+)?$/,
      'Informe o destino como IATA ou IATA - nome (ex.: GYN - Goiânia).',
    ),
    departure_date: z.string().transform((value) => normalizarData(value)),
    earliest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal('')),
    latest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal('')),
  }).strict()).min(1).max(12).optional(),
}).superRefine((details, context) => {
  if (details.passengers) {
    const employeeIds = details.passengers.map((passenger) => passenger.employee_id)
    if (new Set(employeeIds).size !== employeeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passengers'],
        message: 'O mesmo passageiro pode ser informado somente uma vez.',
      })
    }
  }
  const legs = details.trechos || []
  legs.forEach((leg, index) => {
    if (leg.earliest_time && leg.latest_time && leg.latest_time < leg.earliest_time) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trechos', index, 'latest_time'],
        message: 'O fim da faixa de horario deve ser posterior ao inicio.',
      })
    }
  })
})

export const atendimentoSchema = z.object({
  id: z.string().optional(),
  empresa_id: z.string().min(1, 'Empresa obrigatória'),
  funcionario_id: z.string().nullable().optional(),
  passageiro_nome: z.string().min(2, 'Nome do passageiro obrigatório').transform(normalizarNome),
  tipo_servico: z.string().transform(normalizarTipoServico),
  valor_cotacao: valorMonetarioOpcional,
  valor_custo: valorMonetarioOpcional,
  valor_venda: valorMonetarioOpcional,
  valor_final: valorMonetarioOpcional,
  valor_referencia_economia: valorMonetarioOpcional.optional(),
  fonte_referencia_economia: z.enum(['preco_sem_agencia', 'cotacao_original', 'tarifa_publica', 'contrato', 'outro']).optional(),
  status: z.enum(['em_andamento', 'aguardando_cliente', 'finalizado', 'cancelado', 'pendente']).default('em_andamento'),
  prioridade: z.enum(['baixa', 'media', 'alta', 'urgente']).default('media'),
  origem: z.enum(['WhatsApp', 'E-mail', 'Telefone', 'Indicação', 'Portal', 'Outro']).default('Portal'),
  agente_user_id: z.string().min(1, 'Agente obrigatório'),
  observacoes: z.string().optional().transform((v) => v ? normalizarTexto(v) : ''),
  data_atendimento: z.string().transform((v) => normalizarData(v) || todayISODate()),
  detalhes_hotel: detalhesHotelSchema.optional(),
  detalhes_aereo: detalhesAereoSchema.optional(),
  venda_numero: z.string().optional(),
  emissor_codigo: z.string().optional(),
  origem_emissao: z.enum(['manual', 'planilha', 'voucher_pdf', 'caixa_entrada', 'pdf_emissao', 'wintour_xml', 'wintour_planilha', 'wintour_pdf', 'tech_travel_api']).optional(),
})

export const linhaEmissaoSchema = z.object({
  venda_numero: z.string().min(1, 'Número da venda obrigatório'),
  data_venda: z.string().transform((v) => normalizarData(v)),
  passageiro: z.string().min(2).transform(normalizarNome),
  tipo_servico: z.string().transform(normalizarTipoServico),
  empresa_codigo: z.string().optional(),
  empresa_nome: z.string().transform((v) => normalizarTexto(v || '')),
  total: valorMonetarioOpcional,
  custo: valorMonetarioOpcional,
  markup: valorMonetarioOpcional,
  cod_emissor: z.string().optional(),
  status_origem: z.string().optional().transform((v) => normalizarStatusEmissao(v || '')),
  produto: z.string().optional(),
  descricao: z.string().optional(),
})

export const voucherParsedSchema = z.object({
  voucher_numero: z.string().optional(),
  passageiro: z.string().transform(normalizarNome),
  cpf: cpfOpcional,
  hotel: z.string().optional().transform((v) => v ? normalizarTexto(v) : ''),
  cidade: z.string().optional(),
  data_checkin: z.string().optional().transform((v) => v ? normalizarData(v) : ''),
  data_checkout: z.string().optional().transform((v) => v ? normalizarData(v) : ''),
  noites: z.number().int().optional(),
  num_hospedes: z.number().int().min(1).optional(),
  empresa_nome: z.string().optional(),
}).refine((d) => {
  if (d.data_checkin && d.data_checkout) {
    return d.data_checkout > d.data_checkin
  }
  return true
}, { message: 'Datas inválidas no voucher' })

// ============================================================
// Helper: valida e retorna resultado estruturado
// ============================================================

export interface ValidationResult<T> {
  ok: boolean
  data?: T
  erros?: Array<{ campo: string; mensagem: string }>
}

export function validar<T>(schema: z.ZodType<T>, dados: unknown): ValidationResult<T> {
  const r = schema.safeParse(dados)
  if (r.success) return { ok: true, data: r.data }
  return {
    ok: false,
    erros: r.error.errors.map((e) => ({
      campo: e.path.join('.') || '(raiz)',
      mensagem: e.message,
    })),
  }
}

import 'server-only'

import { randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  cardBrandFromDatabase,
  cardBrandToDatabase,
  cardStatusFromDatabase,
  cardTypeFromDatabase,
  cardTypeToDatabase,
  corporateCardCreateSchema,
  corporateFinanceStateSchema,
  corporateInvoiceGenerateSchema,
  corporateInvoiceSettleSchema,
  corporateWalletConfigSchema,
  corporateWalletMovementCreateSchema,
  invoiceStatusFromDatabase,
  movementSourceFromDatabase,
  movementSourceToDatabase,
  movementStatusFromDatabase,
  movementTypeFromDatabase,
  movementTypeToDatabase,
  normalizeLegacyCorporateFinanceState,
  walletProviderFromDatabase,
  walletProviderToDatabase,
  walletStatusFromDatabase,
  walletStatusToDatabase,
  type CorporateCardCreatePayload,
  type CorporateInvoiceGeneratePayload,
  type CorporateInvoiceSettlePayload,
  type CorporateWalletConfigPayload,
  type CorporateWalletMovementCreatePayload,
} from '@/lib/corporate-finance/schema'
import { sha256 } from '@/lib/policy'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  getAccessibleCompanyIds,
  requireCompanyAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  domainRolloutAppliesToCompany,
  domainRolloutIsFullyRelational,
  getDomainRolloutInTransaction,
} from '@/lib/server/domain-rollout-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type {
  CarteiraCorporativa,
  CartaoCorporativo,
  FaturaCorporativa,
  MovimentoCarteiraCorporativa,
} from '@/types'

const STORAGE_KEY = 'bbt-corporate-finance'
const DOMAIN_KEY = 'finance'

interface WalletRow extends QueryResultRow {
  id: string
  company_id: string
  available_balance: string | number
  credit_limit: string | number
  daily_pix_limit: string | number
  monthly_card_limit: string | number
  status: string
  pix_enabled: boolean
  card_enabled: boolean
  provider: string
  virtual_account: string | null
  notes: string | null
  version: string | number
  created_at: string | Date
  updated_at: string | Date
}

interface CardRow extends QueryResultRow {
  id: string
  wallet_id: string
  company_id: string
  employee_id: string | null
  card_type: string
  nickname: string
  holder_name: string | null
  last_four: string
  brand: string
  card_limit: string | number
  month_spend: string | number
  status: string
  merchant_lock: string | null
  expiry_month: string | number | null
  expiry_year: string | number | null
  created_by: string | null
  version: string | number
  created_at: string | Date
  updated_at: string | Date
}

interface MovementRow extends QueryResultRow {
  id: string
  wallet_id: string
  company_id: string
  movement_type: string
  source: string
  amount: string | number
  description: string
  status: string
  demand_id: string | null
  financial_entry_id: string | null
  card_id: string | null
  processed_at: string | Date | null
  created_at: string | Date
}

interface InvoiceRow extends QueryResultRow {
  id: string
  company_id: string
  invoice_number: string
  period_start: string | Date
  period_end: string | Date
  due_date: string | Date
  total_amount: string | number
  settled_amount: string | number
  status: string
  notes: string | null
  version: string | number
  created_at: string | Date
  updated_at: string | Date
}

interface LegacyUnresolvedState {
  carteiras: unknown[]
  cartoes: unknown[]
  movimentos: unknown[]
  faturas: unknown[]
}

export interface CorporateFinanceState {
  carteiras: CarteiraCorporativa[]
  cartoes: CartaoCorporativo[]
  movimentos: MovimentoCarteiraCorporativa[]
  faturas: FaturaCorporativa[]
}

export class CorporateFinanceServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'CorporateFinanceServiceError'
  }
}

export async function listCorporateFinanceState(
  principal: RequestPrincipal,
  companyId?: string,
): Promise<CorporateFinanceState> {
  if (companyId) await requireCompanyAccess(principal, companyId, 'ver_financeiro')
  const allowedCompanyIds = companyId ? [companyId] : corporateFinanceCompanyIds(principal)
  if (!allowedCompanyIds.length) {
    return { carteiras: [], cartoes: [], movimentos: [], faturas: [] }
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const unresolved = await bootstrapLegacyCorporateFinance(client, principal)
    const state = await loadCorporateFinanceState(client, principal.tenantId, allowedCompanyIds)
    await syncCorporateFinanceCompatibilityProjection(client, principal, unresolved)
    return state
  })
}

export async function configureCorporateWallet(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<CarteiraCorporativa> {
  const input = corporateWalletConfigSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.company_id, 'editar_financeiro')
  if (input.provedor !== 'pendente') {
    throw new CorporateFinanceServiceError(
      'CORPORATE_WALLET_PROVIDER_NOT_HOMOLOGATED',
      'Provedor financeiro externo ainda nao homologado. O controle permanece interno.',
      422,
    )
  }

  const wallet = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertCorporateFinanceWriteEnabled(client, principal.tenantId, input.company_id)
    const unresolved = await bootstrapLegacyCorporateFinance(client, principal)
    await assertActiveCompany(client, principal.tenantId, input.company_id)
    const current = await client.query<WalletRow>(
      `select * from corporate_wallets
       where tenant_id = $1 and company_id = $2 and deleted_at is null
       for update`,
      [principal.tenantId, input.company_id],
    )
    if (
      input.expectedVersion !== undefined
      && current.rows[0]
      && Number(current.rows[0].version) !== input.expectedVersion
    ) {
      throw staleVersion('carteira', input.expectedVersion, Number(current.rows[0].version))
    }
    if (input.expectedVersion !== undefined && !current.rows[0]) {
      throw new CorporateFinanceServiceError(
        'CORPORATE_WALLET_NOT_FOUND',
        'Carteira corporativa nao encontrada para a versao informada.',
        404,
      )
    }

    const walletId = current.rows[0]?.id || `wallet_${randomUUID()}`
    const saved = await client.query<WalletRow>(
      `insert into corporate_wallets (
         id, tenant_id, company_id, available_balance, credit_limit,
         daily_pix_limit, monthly_card_limit, status, pix_enabled,
         card_enabled, provider, virtual_account, notes, created_by, updated_by
       ) values ($1, $2, $3, 0, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       on conflict (tenant_id, company_id) do update set
         credit_limit = excluded.credit_limit,
         daily_pix_limit = excluded.daily_pix_limit,
         monthly_card_limit = excluded.monthly_card_limit,
         status = excluded.status,
         pix_enabled = excluded.pix_enabled,
         card_enabled = excluded.card_enabled,
         provider = excluded.provider,
         virtual_account = excluded.virtual_account,
         notes = excluded.notes,
         updated_by = excluded.updated_by,
         version = corporate_wallets.version + 1,
         updated_at = now()
       returning *`,
      [
        walletId,
        principal.tenantId,
        input.company_id,
        input.limite_credito,
        input.limite_pix_diario,
        input.limite_cartao_mensal,
        walletStatusToDatabase(input.status),
        input.pix_habilitado,
        input.cartao_habilitado,
        walletProviderToDatabase(input.provedor),
        input.conta_virtual || null,
        input.observacoes || null,
        principal.user.id,
      ],
    )
    await syncCorporateFinanceCompatibilityProjection(client, principal, unresolved)
    return mapWallet(saved.rows[0])
  })

  await writeAuditEvent({
    action: 'corporate_finance.wallet.configure',
    result: 'success',
    entityType: 'corporate_wallet',
    entityId: wallet.id,
    metadata: { companyId: wallet.company_id, status: wallet.status, version: wallet.version },
  })
  return wallet
}

export async function createCorporateCard(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<CartaoCorporativo> {
  const input = corporateCardCreateSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.company_id, 'editar_financeiro')

  const card = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertCorporateFinanceWriteEnabled(client, principal.tenantId, input.company_id)
    const unresolved = await bootstrapLegacyCorporateFinance(client, principal)
    await assertActiveCompany(client, principal.tenantId, input.company_id)
    if (input.funcionario_id) {
      await assertEmployeeCompany(client, principal.tenantId, input.company_id, input.funcionario_id)
    }
    const wallet = await ensureWallet(client, principal, input.company_id)
    const duplicate = await client.query<{ id: string }>(
      `select id from corporate_cards
       where tenant_id = $1 and wallet_id = $2 and last_four = $3
         and status <> 'cancelled' and deleted_at is null`,
      [principal.tenantId, wallet.id, input.ultimos4],
    )
    if (duplicate.rowCount) {
      throw new CorporateFinanceServiceError(
        'CORPORATE_CARD_DUPLICATE',
        'Ja existe um cartao ativo com estes quatro ultimos digitos nesta carteira.',
        409,
      )
    }
    const saved = await client.query<CardRow>(
      `insert into corporate_cards (
         id, tenant_id, wallet_id, company_id, employee_id, card_type,
         nickname, holder_name, last_four, brand, card_limit, status,
         merchant_lock, expiry_month, expiry_year, created_by, updated_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 'active', $12, $13, $14, $15, $15)
       returning *`,
      [
        `card_${randomUUID()}`,
        principal.tenantId,
        wallet.id,
        input.company_id,
        input.funcionario_id || null,
        cardTypeToDatabase(input.tipo),
        input.apelido,
        input.portador_nome || null,
        input.ultimos4,
        cardBrandToDatabase(input.bandeira),
        input.limite,
        input.merchant_lock || null,
        input.validade_mes || null,
        input.validade_ano || null,
        principal.user.id,
      ],
    )
    await syncCorporateFinanceCompatibilityProjection(client, principal, unresolved)
    return mapCard(saved.rows[0])
  })

  await writeAuditEvent({
    action: 'corporate_finance.card.record',
    result: 'success',
    entityType: 'corporate_card',
    entityId: card.id,
    metadata: {
      companyId: card.company_id,
      walletId: card.carteira_id,
      lastFour: card.ultimos4,
      cardType: card.tipo,
    },
  })
  return card
}

export async function createCorporateWalletMovement(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<{ movement: MovimentoCarteiraCorporativa; wallet: CarteiraCorporativa; reused: boolean }> {
  const input = corporateWalletMovementCreateSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.company_id, 'editar_financeiro')
  if (input.origem !== 'manual') {
    throw new CorporateFinanceServiceError(
      'CORPORATE_MOVEMENT_PROVIDER_REQUIRED',
      'Movimentos Pix, cartao ou integracao exigem confirmacao de um adaptador homologado.',
      422,
    )
  }
  const requestHash = sha256({
    tenantId: principal.tenantId,
    companyId: input.company_id,
    type: input.tipo,
    source: input.origem,
    amount: input.valor,
    description: input.descricao,
    demandId: input.atendimento_id || null,
    financialEntryId: input.lancamento_id || null,
    cardId: input.cartao_id || null,
  })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertCorporateFinanceWriteEnabled(client, principal.tenantId, input.company_id)
    const unresolved = await bootstrapLegacyCorporateFinance(client, principal)
    await client.query(
      'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [principal.tenantId, `corporate-movement:${input.idempotencyKey}`],
    )
    const existing = await client.query<MovementRow & { request_hash: string }>(
      `select * from corporate_wallet_movements
       where tenant_id = $1 and idempotency_key = $2`,
      [principal.tenantId, input.idempotencyKey],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) {
        throw new CorporateFinanceServiceError(
          'CORPORATE_MOVEMENT_IDEMPOTENCY_CONFLICT',
          'A chave de idempotencia ja foi usada com outro movimento.',
          409,
        )
      }
      if (existing.rows[0].company_id !== input.company_id) {
        throw new CorporateFinanceServiceError(
          'CORPORATE_MOVEMENT_SCOPE_CONFLICT',
          'O movimento existente pertence a outra empresa.',
          403,
        )
      }
      const wallet = await loadWalletById(client, principal.tenantId, existing.rows[0].wallet_id)
      return {
        movement: mapMovement(existing.rows[0]),
        wallet: mapWallet(wallet),
        reused: true,
      }
    }
    const wallet = await ensureWallet(client, principal, input.company_id)
    if (wallet.status !== 'active') {
      throw new CorporateFinanceServiceError(
        'CORPORATE_WALLET_NOT_ACTIVE',
        'Ative o controle interno da empresa antes de registrar movimentos.',
        409,
      )
    }
    await assertMovementReferences(client, principal.tenantId, input)
    const inserted = await client.query<MovementRow>(
      `insert into corporate_wallet_movements (
         id, tenant_id, wallet_id, company_id, movement_type, source,
         amount, description, status, demand_id, financial_entry_id,
         card_id, external_reference, idempotency_key, request_hash,
         processed_at, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'processed',
                 $9, $10, $11, $12, $13, $14, now(), $15)
       returning *`,
      [
        `mov_${randomUUID()}`,
        principal.tenantId,
        wallet.id,
        input.company_id,
        movementTypeToDatabase(input.tipo),
        movementSourceToDatabase(input.origem),
        input.valor,
        input.descricao,
        input.atendimento_id || null,
        input.lancamento_id || null,
        input.cartao_id || null,
        input.external_reference || null,
        input.idempotencyKey,
        requestHash,
        principal.user.id,
      ],
    )
    const updatedWallet = await loadWalletById(client, principal.tenantId, wallet.id)
    await syncCorporateFinanceCompatibilityProjection(client, principal, unresolved)
    return {
      movement: mapMovement(inserted.rows[0]),
      wallet: mapWallet(updatedWallet),
      reused: false,
    }
  })

  await writeAuditEvent({
    action: result.reused
      ? 'corporate_finance.movement.reused'
      : 'corporate_finance.movement.create',
    result: 'success',
    entityType: 'corporate_wallet_movement',
    entityId: result.movement.id,
    metadata: {
      companyId: result.movement.company_id,
      walletId: result.movement.carteira_id,
      type: result.movement.tipo,
      amount: result.movement.valor,
    },
  })
  return result
}

export async function generateCorporateInvoice(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<{ invoice: FaturaCorporativa; reused: boolean }> {
  const input = corporateInvoiceGenerateSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.company_id, 'editar_financeiro')
  const requestHash = sha256({ tenantId: principal.tenantId, ...input })
  const operation = 'corporate_invoice_generate'

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertCorporateFinanceWriteEnabled(client, principal.tenantId, input.company_id)
    const unresolved = await bootstrapLegacyCorporateFinance(client, principal)
    const replay = await beginIdempotentOperation(
      client,
      principal.tenantId,
      operation,
      input.idempotencyKey,
      requestHash,
    )
    if (replay) {
      const invoiceId = String(replay.invoiceId || '')
      const invoice = await loadInvoiceById(client, principal.tenantId, invoiceId)
      if (invoice.company_id !== input.company_id) {
        throw new CorporateFinanceServiceError(
          'CORPORATE_INVOICE_SCOPE_CONFLICT',
          'A fatura existente pertence a outra empresa.',
          403,
        )
      }
      return { invoice: await mapInvoiceWithLinks(client, principal.tenantId, invoice), reused: true }
    }

    await assertActiveCompany(client, principal.tenantId, input.company_id)
    const existing = await client.query<InvoiceRow>(
      `select * from corporate_invoices
       where tenant_id = $1 and company_id = $2
         and period_start = $3 and period_end = $4 and deleted_at is null
       for update`,
      [principal.tenantId, input.company_id, input.periodo_inicio, input.periodo_fim],
    )
    const invoiceId = existing.rows[0]?.id || `invoice_${randomUUID()}`
    const entries = await client.query<{
      id: string
      demand_id: string | null
      amount: string | number
    }>(
      `select entry.id, entry.demand_id, entry.amount
       from financial_entries entry
       where entry.tenant_id = $1
         and entry.company_id = $2
         and entry.entry_type = 'receivable'
         and entry.status <> 'cancelled'
         and entry.deleted_at is null
         and coalesce(entry.issued_on, entry.created_at::date) between $3 and $4
         and not exists (
           select 1
           from corporate_invoice_financial_entries link
           join corporate_invoices other_invoice
             on other_invoice.tenant_id = link.tenant_id
            and other_invoice.id = link.invoice_id
           where link.tenant_id = entry.tenant_id
             and link.financial_entry_id = entry.id
             and other_invoice.id <> $5
             and other_invoice.status <> 'cancelled'
             and other_invoice.deleted_at is null
         )
       order by coalesce(entry.issued_on, entry.created_at::date), entry.id
       for update of entry`,
      [
        principal.tenantId,
        input.company_id,
        input.periodo_inicio,
        input.periodo_fim,
        invoiceId,
      ],
    )
    const total = entries.rows.reduce((sum, entry) => sum + Number(entry.amount), 0)
    const settled = Number(existing.rows[0]?.settled_amount || 0)
    if (settled > total + 0.009) {
      throw new CorporateFinanceServiceError(
        'CORPORATE_INVOICE_TOTAL_BELOW_SETTLED',
        'O novo total da fatura e menor que o valor ja liquidado.',
        409,
      )
    }
    const invoiceNumber = existing.rows[0]?.invoice_number
      || invoiceNumberFor(input.company_id, input.periodo_inicio)
    const status = settled >= total - 0.009 && total > 0
      ? 'paid'
      : input.vencimento < todayDate()
        ? 'overdue'
        : 'open'
    const fingerprint = sha256({
      tenantId: principal.tenantId,
      companyId: input.company_id,
      periodStart: input.periodo_inicio,
      periodEnd: input.periodo_fim,
    })
    const saved = await client.query<InvoiceRow>(
      `insert into corporate_invoices (
         id, tenant_id, company_id, invoice_number, period_start, period_end,
         due_date, total_amount, settled_amount, status, notes, fingerprint,
         created_by, updated_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $12)
       on conflict (tenant_id, company_id, period_start, period_end) do update set
         due_date = excluded.due_date,
         total_amount = excluded.total_amount,
         status = excluded.status,
         notes = excluded.notes,
         updated_by = excluded.updated_by,
         version = corporate_invoices.version + 1,
         updated_at = now()
       returning *`,
      [
        invoiceId,
        principal.tenantId,
        input.company_id,
        invoiceNumber,
        input.periodo_inicio,
        input.periodo_fim,
        input.vencimento,
        total,
        status,
        input.observacoes || null,
        fingerprint,
        principal.user.id,
      ],
    )
    await client.query(
      `delete from corporate_invoice_financial_entries
       where tenant_id = $1 and invoice_id = $2`,
      [principal.tenantId, saved.rows[0].id],
    )
    await client.query(
      `delete from corporate_invoice_demands
       where tenant_id = $1 and invoice_id = $2`,
      [principal.tenantId, saved.rows[0].id],
    )
    if (entries.rows.length) {
      const entryLinks = entries.rows.map((entry) => ({
        financial_entry_id: entry.id,
        entry_amount: Number(entry.amount),
      }))
      await client.query(
        `insert into corporate_invoice_financial_entries (
           tenant_id, invoice_id, company_id, financial_entry_id, entry_amount
         )
         select $1, $2, $3, item.financial_entry_id, item.entry_amount
         from jsonb_to_recordset($4::jsonb) as item(
           financial_entry_id text,
           entry_amount numeric
         )`,
        [principal.tenantId, saved.rows[0].id, input.company_id, JSON.stringify(entryLinks)],
      )
      const demandIds = Array.from(new Set(
        entries.rows.map((entry) => entry.demand_id).filter(Boolean) as string[],
      ))
      if (demandIds.length) {
        await client.query(
          `insert into corporate_invoice_demands (
             tenant_id, invoice_id, company_id, demand_id
           )
           select $1, $2, $3, unnest($4::text[])`,
          [principal.tenantId, saved.rows[0].id, input.company_id, demandIds],
        )
      }
    }
    const invoice = await mapInvoiceWithLinks(client, principal.tenantId, saved.rows[0])
    await completeIdempotentOperation(
      client,
      principal.tenantId,
      operation,
      input.idempotencyKey,
      { invoiceId: invoice.id },
    )
    await syncCorporateFinanceCompatibilityProjection(client, principal, unresolved)
    return { invoice, reused: false }
  })

  await writeAuditEvent({
    action: result.reused
      ? 'corporate_finance.invoice.reused'
      : 'corporate_finance.invoice.generate',
    result: 'success',
    entityType: 'corporate_invoice',
    entityId: result.invoice.id,
    metadata: {
      companyId: result.invoice.company_id,
      total: result.invoice.valor_total,
      periodStart: result.invoice.periodo_inicio,
      periodEnd: result.invoice.periodo_fim,
    },
  })
  return result
}

export async function settleCorporateInvoice(
  principal: RequestPrincipal,
  invoiceId: string,
  rawInput: unknown,
): Promise<{ invoice: FaturaCorporativa; reused: boolean }> {
  const input = corporateInvoiceSettleSchema.parse(rawInput)
  const operation = `corporate_invoice_settle:${invoiceId}`
  const requestHash = sha256({ tenantId: principal.tenantId, invoiceId, ...input })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const unresolved = await bootstrapLegacyCorporateFinance(client, principal)
    const current = await loadInvoiceById(client, principal.tenantId, invoiceId, true)
    await requireCompanyAccess(principal, current.company_id, 'editar_financeiro')
    await assertCorporateFinanceWriteEnabled(client, principal.tenantId, current.company_id)
    const replay = await beginIdempotentOperation(
      client,
      principal.tenantId,
      operation,
      input.idempotencyKey,
      requestHash,
    )
    if (replay) {
      return {
        invoice: await mapInvoiceWithLinks(client, principal.tenantId, current),
        reused: true,
      }
    }
    if (Number(current.version) !== input.expectedVersion) {
      throw staleVersion('fatura', input.expectedVersion, Number(current.version))
    }
    if (current.status === 'cancelled') {
      throw new CorporateFinanceServiceError(
        'CORPORATE_INVOICE_CANCELLED',
        'Fatura cancelada nao pode ser liquidada.',
        409,
      )
    }
    const total = Number(current.total_amount)
    const alreadySettled = Number(current.settled_amount)
    const remaining = Math.max(0, total - alreadySettled)
    const amount = Math.min(remaining, input.valor_pago ?? remaining)
    if (amount <= 0) {
      throw new CorporateFinanceServiceError(
        'CORPORATE_INVOICE_ALREADY_SETTLED',
        'Fatura ja esta totalmente liquidada.',
        409,
      )
    }

    let amountToAllocate = amount
    const entries = await client.query<{
      id: string
      amount: string | number
      settled_amount: string | number
    }>(
      `select entry.id, entry.amount, entry.settled_amount
       from corporate_invoice_financial_entries link
       join financial_entries entry
         on entry.tenant_id = link.tenant_id
        and entry.id = link.financial_entry_id
       where link.tenant_id = $1 and link.invoice_id = $2
         and entry.deleted_at is null and entry.status <> 'cancelled'
       order by coalesce(entry.due_date, entry.created_at::date), entry.id
       for update of entry`,
      [principal.tenantId, invoiceId],
    )
    for (const entry of entries.rows) {
      if (amountToAllocate <= 0.009) break
      const entryRemaining = Math.max(0, Number(entry.amount) - Number(entry.settled_amount))
      const applied = Math.min(entryRemaining, amountToAllocate)
      if (applied <= 0) continue
      await client.query(
        `update financial_entries
         set settled_amount = settled_amount + $3,
             status = case
               when settled_amount + $3 >= amount - 0.01 then 'paid'
               else 'partial'
             end,
             settled_at = case
               when settled_amount + $3 >= amount - 0.01 then now()
               else settled_at
             end,
             updated_by = $4,
             version = version + 1,
             updated_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, entry.id, applied, principal.user.id],
      )
      amountToAllocate -= applied
    }
    const newSettled = alreadySettled + amount
    const saved = await client.query<InvoiceRow>(
      `update corporate_invoices
       set settled_amount = $3,
           status = case when $3 >= total_amount - 0.01 then 'paid' else 'open' end,
           updated_by = $4,
           version = version + 1,
           updated_at = now()
       where tenant_id = $1 and id = $2
       returning *`,
      [principal.tenantId, invoiceId, newSettled, principal.user.id],
    )
    const invoice = await mapInvoiceWithLinks(client, principal.tenantId, saved.rows[0])
    await completeIdempotentOperation(
      client,
      principal.tenantId,
      operation,
      input.idempotencyKey,
      { invoiceId: invoice.id },
    )
    await syncCorporateFinanceCompatibilityProjection(client, principal, unresolved)
    return { invoice, reused: false }
  })

  await writeAuditEvent({
    action: result.reused
      ? 'corporate_finance.invoice_settlement.reused'
      : 'corporate_finance.invoice.settle',
    result: 'success',
    entityType: 'corporate_invoice',
    entityId: result.invoice.id,
    metadata: {
      companyId: result.invoice.company_id,
      settledAmount: result.invoice.valor_pago,
      totalAmount: result.invoice.valor_total,
    },
  })
  return result
}

async function loadCorporateFinanceState(
  client: PoolClient,
  tenantId: string,
  companyIds: string[],
): Promise<CorporateFinanceState> {
  const wallets = await client.query<WalletRow>(
    `select * from corporate_wallets
     where tenant_id = $1 and company_id = any($2::text[]) and deleted_at is null
     order by created_at, id`,
    [tenantId, companyIds],
  )
  const cards = await client.query<CardRow>(
    `select * from corporate_cards
     where tenant_id = $1 and company_id = any($2::text[]) and deleted_at is null
     order by created_at desc, id`,
    [tenantId, companyIds],
  )
  const movements = await client.query<MovementRow>(
    `select * from corporate_wallet_movements
     where tenant_id = $1 and company_id = any($2::text[])
     order by created_at desc, id desc
     limit 10000`,
    [tenantId, companyIds],
  )
  const invoices = await client.query<InvoiceRow>(
    `select * from corporate_invoices
     where tenant_id = $1 and company_id = any($2::text[]) and deleted_at is null
     order by period_end desc, created_at desc`,
    [tenantId, companyIds],
  )
  const mappedInvoices: FaturaCorporativa[] = []
  for (const invoice of invoices.rows) {
    mappedInvoices.push(await mapInvoiceWithLinks(client, tenantId, invoice))
  }
  return corporateFinanceStateSchema.parse({
    carteiras: wallets.rows.map(mapWallet),
    cartoes: cards.rows.map(mapCard),
    movimentos: movements.rows.map(mapMovement),
    faturas: mappedInvoices,
  }) as CorporateFinanceState
}

async function mapInvoiceWithLinks(
  client: PoolClient,
  tenantId: string,
  row: InvoiceRow,
): Promise<FaturaCorporativa> {
  const entryLinks = await client.query<{ financial_entry_id: string }>(
    `select financial_entry_id
     from corporate_invoice_financial_entries
     where tenant_id = $1 and invoice_id = $2
     order by financial_entry_id`,
    [tenantId, row.id],
  )
  const demandLinks = await client.query<{ demand_id: string }>(
    `select demand_id
     from corporate_invoice_demands
     where tenant_id = $1 and invoice_id = $2
     order by demand_id`,
    [tenantId, row.id],
  )
  const status = row.status === 'open' && dateOnly(row.due_date) < todayDate()
    ? 'vencida'
    : invoiceStatusFromDatabase(row.status)
  return {
    id: row.id,
    company_id: row.company_id,
    numero: row.invoice_number,
    periodo_inicio: dateOnly(row.period_start),
    periodo_fim: dateOnly(row.period_end),
    vencimento: dateOnly(row.due_date),
    valor_total: Number(row.total_amount),
    valor_pago: Number(row.settled_amount),
    status,
    lancamento_ids: entryLinks.rows.map((link) => link.financial_entry_id),
    atendimento_ids: demandLinks.rows.map((link) => link.demand_id),
    observacoes: row.notes || undefined,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    version: Number(row.version),
  }
}

function mapWallet(row: WalletRow): CarteiraCorporativa {
  return {
    id: row.id,
    company_id: row.company_id,
    saldo_disponivel: Number(row.available_balance),
    limite_credito: Number(row.credit_limit),
    limite_pix_diario: Number(row.daily_pix_limit),
    limite_cartao_mensal: Number(row.monthly_card_limit),
    status: walletStatusFromDatabase(row.status),
    pix_habilitado: row.pix_enabled,
    cartao_habilitado: row.card_enabled,
    provedor: walletProviderFromDatabase(row.provider),
    conta_virtual: row.virtual_account || undefined,
    observacoes: row.notes || undefined,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    version: Number(row.version),
  }
}

function mapCard(row: CardRow): CartaoCorporativo {
  return {
    id: row.id,
    carteira_id: row.wallet_id,
    company_id: row.company_id,
    funcionario_id: row.employee_id,
    tipo: cardTypeFromDatabase(row.card_type),
    apelido: row.nickname,
    portador_nome: row.holder_name || undefined,
    ultimos4: row.last_four,
    bandeira: cardBrandFromDatabase(row.brand),
    limite: Number(row.card_limit),
    gasto_mes: Number(row.month_spend),
    status: cardStatusFromDatabase(row.status),
    merchant_lock: row.merchant_lock || undefined,
    validade_mes: row.expiry_month === null ? undefined : Number(row.expiry_month),
    validade_ano: row.expiry_year === null ? undefined : Number(row.expiry_year),
    criado_por_user_id: row.created_by || undefined,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    version: Number(row.version),
  }
}

function mapMovement(row: MovementRow): MovimentoCarteiraCorporativa {
  return {
    id: row.id,
    carteira_id: row.wallet_id,
    company_id: row.company_id,
    tipo: movementTypeFromDatabase(row.movement_type),
    origem: movementSourceFromDatabase(row.source),
    valor: Number(row.amount),
    descricao: row.description,
    status: movementStatusFromDatabase(row.status),
    atendimento_id: row.demand_id || undefined,
    lancamento_id: row.financial_entry_id || undefined,
    cartao_id: row.card_id || undefined,
    created_at: toIso(row.created_at),
    processado_em: row.processed_at ? toIso(row.processed_at) : undefined,
  }
}

async function bootstrapLegacyCorporateFinance(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<LegacyUnresolvedState> {
  const empty = { carteiras: [], cartoes: [], movimentos: [], faturas: [] }
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, DOMAIN_KEY)
  if (domainRolloutIsFullyRelational(rollout)) return empty
  await client.query(
    'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [principal.tenantId, STORAGE_KEY],
  )
  const storage = await client.query<{ value: unknown }>(
    `select value from app_kv
     where tenant_id = $1 and key = $2
     for update`,
    [principal.tenantId, STORAGE_KEY],
  )
  if (!storage.rows[0]?.value) return empty
  const legacy = normalizeLegacyCorporateFinanceState(storage.rows[0].value)
  const unresolved: LegacyUnresolvedState = {
    carteiras: [...legacy.unresolved.carteiras],
    cartoes: [...legacy.unresolved.cartoes],
    movimentos: [...legacy.unresolved.movimentos],
    faturas: [...legacy.unresolved.faturas],
  }
  if (
    !legacy.carteiras.length
    && !legacy.cartoes.length
    && !legacy.movimentos.length
    && !legacy.faturas.length
  ) return unresolved

  const companyRows = await client.query<{ id: string }>(
    `select id from companies
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const companyIds = new Set(companyRows.rows.map((row) => row.id))
  const validWallets = legacy.carteiras.filter((wallet) => {
    const valid = companyIds.has(wallet.company_id)
    if (!valid) unresolved.carteiras.push(wallet)
    return valid
  })
  if (validWallets.length) {
    await client.query(
      `with input as (
         select * from jsonb_to_recordset($2::jsonb) as item(
           id text, company_id text, available_balance numeric,
           credit_limit numeric, daily_pix_limit numeric,
           monthly_card_limit numeric, status text, pix_enabled boolean,
           card_enabled boolean, provider text, virtual_account text,
           notes text, created_at timestamptz, updated_at timestamptz
         )
       )
       insert into corporate_wallets (
         id, tenant_id, company_id, available_balance, credit_limit,
         daily_pix_limit, monthly_card_limit, status, pix_enabled,
         card_enabled, provider, virtual_account, notes, created_by,
         updated_by, created_at, updated_at
       )
       select input.id, $1, input.company_id, input.available_balance,
              input.credit_limit, input.daily_pix_limit,
              input.monthly_card_limit, input.status, input.pix_enabled,
              input.card_enabled, input.provider, input.virtual_account,
              input.notes, $3, $3, input.created_at, input.updated_at
       from input
       on conflict (tenant_id, company_id) do nothing`,
      [
        principal.tenantId,
        JSON.stringify(validWallets.map((wallet) => ({
          id: wallet.id,
          company_id: wallet.company_id,
          available_balance: wallet.saldo_disponivel,
          credit_limit: wallet.limite_credito,
          daily_pix_limit: wallet.limite_pix_diario,
          monthly_card_limit: wallet.limite_cartao_mensal,
          status: walletStatusToDatabase(wallet.status),
          pix_enabled: wallet.pix_habilitado,
          card_enabled: wallet.cartao_habilitado,
          provider: walletProviderToDatabase(wallet.provedor),
          virtual_account: wallet.conta_virtual || null,
          notes: wallet.observacoes || null,
          created_at: wallet.created_at,
          updated_at: wallet.updated_at || wallet.created_at,
        }))),
        principal.user.id,
      ],
    )
  }

  const wallets = await client.query<{ id: string; company_id: string }>(
    `select id, company_id from corporate_wallets
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const walletByCompany = new Map(wallets.rows.map((row) => [row.company_id, row.id]))
  const employees = await client.query<{ id: string; company_id: string }>(
    `select id, company_id from employees
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const employeeCompanies = new Map(employees.rows.map((row) => [row.id, row.company_id]))
  const validCards = legacy.cartoes.filter((card) => {
    const valid = Boolean(walletByCompany.get(card.company_id))
      && (!card.funcionario_id || employeeCompanies.get(card.funcionario_id) === card.company_id)
    if (!valid) unresolved.cartoes.push(card)
    return valid
  })
  if (validCards.length) {
    await client.query(
      `with input as (
         select * from jsonb_to_recordset($2::jsonb) as item(
           id text, wallet_id text, company_id text, employee_id text,
           card_type text, nickname text, holder_name text, last_four text,
           brand text, card_limit numeric, month_spend numeric, status text,
           merchant_lock text, expiry_month smallint, expiry_year smallint,
           created_at timestamptz, updated_at timestamptz
         )
       )
       insert into corporate_cards (
         id, tenant_id, wallet_id, company_id, employee_id, card_type,
         nickname, holder_name, last_four, brand, card_limit, month_spend,
         status, merchant_lock, expiry_month, expiry_year, created_by,
         updated_by, created_at, updated_at
       )
       select input.id, $1, input.wallet_id, input.company_id,
              input.employee_id, input.card_type, input.nickname,
              input.holder_name, input.last_four, input.brand,
              input.card_limit, input.month_spend, input.status,
              input.merchant_lock, input.expiry_month, input.expiry_year,
              $3, $3, input.created_at, input.updated_at
       from input
       on conflict (tenant_id, id) do nothing`,
      [
        principal.tenantId,
        JSON.stringify(validCards.map((card) => ({
          id: card.id,
          wallet_id: walletByCompany.get(card.company_id),
          company_id: card.company_id,
          employee_id: card.funcionario_id || null,
          card_type: cardTypeToDatabase(card.tipo),
          nickname: card.apelido,
          holder_name: card.portador_nome || null,
          last_four: card.ultimos4,
          brand: cardBrandToDatabase(card.bandeira || 'Outra'),
          card_limit: card.limite,
          month_spend: card.gasto_mes,
          status: card.status === 'ativo'
            ? 'active'
            : card.status === 'bloqueado'
              ? 'blocked'
              : card.status === 'cancelado'
                ? 'cancelled'
                : 'pending_issuance',
          merchant_lock: card.merchant_lock || null,
          expiry_month: card.validade_mes || null,
          expiry_year: card.validade_ano || null,
          created_at: card.created_at,
          updated_at: card.updated_at || card.created_at,
        }))),
        principal.user.id,
      ],
    )
  }

  const cards = await client.query<{ id: string; company_id: string }>(
    `select id, company_id from corporate_cards where tenant_id = $1`,
    [principal.tenantId],
  )
  const cardCompanies = new Map(cards.rows.map((row) => [row.id, row.company_id]))
  const demands = await client.query<{ id: string; company_id: string }>(
    `select id, company_id from demands
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const demandCompanies = new Map(demands.rows.map((row) => [row.id, row.company_id]))
  const financialEntries = await client.query<{ id: string; company_id: string }>(
    `select id, company_id from financial_entries
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const financialEntryCompanies = new Map(
    financialEntries.rows.map((row) => [row.id, row.company_id]),
  )
  const validMovements = legacy.movimentos.filter((movement) => {
    const valid = Boolean(walletByCompany.get(movement.company_id))
      && (!movement.cartao_id || cardCompanies.get(movement.cartao_id) === movement.company_id)
      && (!movement.atendimento_id || demandCompanies.get(movement.atendimento_id) === movement.company_id)
      && (!movement.lancamento_id || financialEntryCompanies.get(movement.lancamento_id) === movement.company_id)
    if (!valid) unresolved.movimentos.push(movement)
    return valid
  })
  if (validMovements.length) {
    await client.query(`select set_config('app.corporate_finance_bootstrap', 'on', true)`)
    await client.query(
      `with input as (
         select * from jsonb_to_recordset($2::jsonb) as item(
           id text, wallet_id text, company_id text, movement_type text,
           source text, amount numeric, description text, status text,
           demand_id text, financial_entry_id text, card_id text,
           external_reference text, idempotency_key text, request_hash text,
           processed_at timestamptz, created_at timestamptz
         )
       )
       insert into corporate_wallet_movements (
         id, tenant_id, wallet_id, company_id, movement_type, source,
         amount, description, status, demand_id, financial_entry_id,
         card_id, external_reference, idempotency_key, request_hash,
         processed_at, created_by, created_at
       )
       select input.id, $1, input.wallet_id, input.company_id,
              input.movement_type, input.source, input.amount,
              input.description, input.status, input.demand_id,
              input.financial_entry_id, input.card_id,
              input.external_reference, input.idempotency_key, input.request_hash,
              input.processed_at, $3, input.created_at
       from input
       on conflict (tenant_id, id) do nothing`,
      [
        principal.tenantId,
        JSON.stringify(validMovements.map((movement) => ({
          id: movement.id,
          wallet_id: walletByCompany.get(movement.company_id),
          company_id: movement.company_id,
          movement_type: movementTypeToDatabase(movement.tipo),
          source: movementSourceToDatabase(movement.origem),
          amount: movement.valor,
          description: movement.descricao,
          status: movement.status === 'processado'
            ? 'processed'
            : movement.status === 'falhou'
              ? 'failed'
              : movement.status === 'cancelado'
                ? 'cancelled'
                : 'pending',
          demand_id: movement.atendimento_id || null,
          financial_entry_id: movement.lancamento_id || null,
          card_id: movement.cartao_id || null,
          external_reference: `legacy:${movement.id}`,
          idempotency_key: `legacy:${movement.id}`,
          request_hash: sha256({ tenantId: principal.tenantId, legacyMovement: movement }),
          processed_at: movement.status === 'processado'
            ? movement.processado_em || movement.created_at
            : null,
          created_at: movement.created_at,
        }))),
        principal.user.id,
      ],
    )
  }

  const validInvoices = legacy.faturas.filter((invoice) => {
    const valid = companyIds.has(invoice.company_id)
      && invoice.lancamento_ids.every((id) => financialEntryCompanies.get(id) === invoice.company_id)
      && invoice.atendimento_ids.every((id) => demandCompanies.get(id) === invoice.company_id)
    if (!valid) unresolved.faturas.push(invoice)
    return valid
  })
  for (const invoice of validInvoices) {
    const fingerprint = sha256({
      tenantId: principal.tenantId,
      companyId: invoice.company_id,
      periodStart: invoice.periodo_inicio,
      periodEnd: invoice.periodo_fim,
    })
    await client.query(
      `insert into corporate_invoices (
         id, tenant_id, company_id, invoice_number, period_start,
         period_end, due_date, total_amount, settled_amount, status,
         notes, fingerprint, created_by, updated_by, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $13, $14, $15)
       on conflict do nothing`,
      [
        invoice.id,
        principal.tenantId,
        invoice.company_id,
        invoice.numero,
        invoice.periodo_inicio,
        invoice.periodo_fim,
        invoice.vencimento,
        invoice.valor_total,
        invoice.valor_pago,
        invoice.status === 'paga'
          ? 'paid'
          : invoice.status === 'fechada'
            ? 'closed'
            : invoice.status === 'vencida'
              ? 'overdue'
              : invoice.status === 'cancelada'
                ? 'cancelled'
                : 'open',
        invoice.observacoes || null,
        fingerprint,
        principal.user.id,
        invoice.created_at,
        invoice.updated_at || invoice.created_at,
      ],
    )
    const persistedInvoice = await client.query<{ id: string }>(
      `select id
       from corporate_invoices
       where tenant_id = $1
         and company_id = $2
         and deleted_at is null
         and (
           id = $3
           or (period_start = $4 and period_end = $5)
           or fingerprint = $6
         )
       order by case when id = $3 then 0 else 1 end
       limit 1`,
      [
        principal.tenantId,
        invoice.company_id,
        invoice.id,
        invoice.periodo_inicio,
        invoice.periodo_fim,
        fingerprint,
      ],
    )
    const persistedInvoiceId = persistedInvoice.rows[0]?.id
    if (!persistedInvoiceId) {
      unresolved.faturas.push(invoice)
      continue
    }
    if (invoice.lancamento_ids.length) {
      await client.query(
        `insert into corporate_invoice_financial_entries (
           tenant_id, invoice_id, company_id, financial_entry_id, entry_amount
         )
         select $1, $2, $3, entry.id, entry.amount
         from financial_entries entry
         where entry.tenant_id = $1 and entry.id = any($4::text[])
         on conflict do nothing`,
        [
          principal.tenantId,
          persistedInvoiceId,
          invoice.company_id,
          invoice.lancamento_ids,
        ],
      )
    }
    if (invoice.atendimento_ids.length) {
      await client.query(
        `insert into corporate_invoice_demands (
           tenant_id, invoice_id, company_id, demand_id
         )
         select $1, $2, $3, unnest($4::text[])
         on conflict do nothing`,
        [
          principal.tenantId,
          persistedInvoiceId,
          invoice.company_id,
          invoice.atendimento_ids,
        ],
      )
    }
  }
  return unresolved
}

async function syncCorporateFinanceCompatibilityProjection(
  client: PoolClient,
  principal: RequestPrincipal,
  unresolved: LegacyUnresolvedState,
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, DOMAIN_KEY)
  if (domainRolloutIsFullyRelational(rollout)) return
  const companies = await client.query<{ id: string }>(
    `select id from companies where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const state = companies.rows.length
    ? await loadCorporateFinanceState(
        client,
        principal.tenantId,
        companies.rows.map((row) => row.id),
      )
    : { carteiras: [], cartoes: [], movimentos: [], faturas: [] }
  const projection = {
    carteiras: mergeUnresolved(unresolved.carteiras, state.carteiras),
    cartoes: mergeUnresolved(unresolved.cartoes, state.cartoes),
    movimentos: mergeUnresolved(unresolved.movimentos, state.movimentos),
    faturas: mergeUnresolved(unresolved.faturas, state.faturas),
  }
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, $2, $3::jsonb, $4)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       updated_by = excluded.updated_by,
       version = app_kv.version + 1,
       updated_at = now()`,
    [principal.tenantId, STORAGE_KEY, JSON.stringify(projection), principal.user.id],
  )
}

async function ensureWallet(
  client: PoolClient,
  principal: RequestPrincipal,
  companyId: string,
): Promise<WalletRow> {
  await client.query(
    `insert into corporate_wallets (
       id, tenant_id, company_id, created_by, updated_by
     ) values ($1, $2, $3, $4, $4)
     on conflict (tenant_id, company_id) do nothing`,
    [`wallet_${randomUUID()}`, principal.tenantId, companyId, principal.user.id],
  )
  const result = await client.query<WalletRow>(
    `select * from corporate_wallets
     where tenant_id = $1 and company_id = $2 and deleted_at is null
     for update`,
    [principal.tenantId, companyId],
  )
  if (!result.rows[0]) {
    throw new CorporateFinanceServiceError(
      'CORPORATE_WALLET_NOT_FOUND',
      'Carteira corporativa nao encontrada.',
      404,
    )
  }
  return result.rows[0]
}

async function loadWalletById(
  client: PoolClient,
  tenantId: string,
  walletId: string,
): Promise<WalletRow> {
  const result = await client.query<WalletRow>(
    `select * from corporate_wallets
     where tenant_id = $1 and id = $2 and deleted_at is null`,
    [tenantId, walletId],
  )
  if (!result.rows[0]) {
    throw new CorporateFinanceServiceError(
      'CORPORATE_WALLET_NOT_FOUND',
      'Carteira corporativa nao encontrada.',
      404,
    )
  }
  return result.rows[0]
}

async function loadInvoiceById(
  client: PoolClient,
  tenantId: string,
  invoiceId: string,
  forUpdate = false,
): Promise<InvoiceRow> {
  const result = await client.query<InvoiceRow>(
    `select * from corporate_invoices
     where tenant_id = $1 and id = $2 and deleted_at is null
     ${forUpdate ? 'for update' : ''}`,
    [tenantId, invoiceId],
  )
  if (!result.rows[0]) {
    throw new CorporateFinanceServiceError(
      'CORPORATE_INVOICE_NOT_FOUND',
      'Fatura corporativa nao encontrada.',
      404,
    )
  }
  return result.rows[0]
}

async function assertCorporateFinanceWriteEnabled(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, tenantId, DOMAIN_KEY)
  if (
    !domainRolloutAppliesToCompany(rollout, companyId)
    || rollout.writeMode === 'legacy'
  ) {
    throw new CorporateFinanceServiceError(
      'CORPORATE_FINANCE_RELATIONAL_WRITE_DISABLED',
      'O controle financeiro corporativo permanece no modo legado para esta empresa.',
      409,
      { companyId, writeMode: rollout.writeMode, rolloutStatus: rollout.status },
    )
  }
}

async function assertActiveCompany(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const result = await client.query(
    `select 1 from companies
     where tenant_id = $1 and id = $2 and status = 'active' and deleted_at is null`,
    [tenantId, companyId],
  )
  if (!result.rowCount) {
    throw new CorporateFinanceServiceError(
      'CORPORATE_FINANCE_COMPANY_NOT_FOUND',
      'Empresa nao encontrada ou inativa.',
      404,
    )
  }
}

async function assertEmployeeCompany(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  employeeId: string,
): Promise<void> {
  const result = await client.query(
    `select 1 from employees
     where tenant_id = $1 and id = $2 and company_id = $3
       and status = 'active' and deleted_at is null`,
    [tenantId, employeeId, companyId],
  )
  if (!result.rowCount) {
    throw new CorporateFinanceServiceError(
      'CORPORATE_CARD_EMPLOYEE_SCOPE_INVALID',
      'Funcionario nao pertence a empresa ou esta inativo.',
      409,
    )
  }
}

async function assertMovementReferences(
  client: PoolClient,
  tenantId: string,
  input: CorporateWalletMovementCreatePayload,
): Promise<void> {
  if (input.atendimento_id) {
    const demand = await client.query(
      `select 1 from demands
       where tenant_id = $1 and id = $2 and company_id = $3 and deleted_at is null`,
      [tenantId, input.atendimento_id, input.company_id],
    )
    if (!demand.rowCount) {
      throw new CorporateFinanceServiceError(
        'CORPORATE_MOVEMENT_DEMAND_SCOPE_INVALID',
        'Demanda nao pertence a empresa.',
        409,
      )
    }
  }
  if (input.lancamento_id) {
    const entry = await client.query(
      `select 1 from financial_entries
       where tenant_id = $1 and id = $2 and company_id = $3 and deleted_at is null`,
      [tenantId, input.lancamento_id, input.company_id],
    )
    if (!entry.rowCount) {
      throw new CorporateFinanceServiceError(
        'CORPORATE_MOVEMENT_ENTRY_SCOPE_INVALID',
        'Lancamento financeiro nao pertence a empresa.',
        409,
      )
    }
  }
  if (input.cartao_id) {
    const card = await client.query(
      `select 1 from corporate_cards
       where tenant_id = $1 and id = $2 and company_id = $3
         and status = 'active' and deleted_at is null`,
      [tenantId, input.cartao_id, input.company_id],
    )
    if (!card.rowCount) {
      throw new CorporateFinanceServiceError(
        'CORPORATE_MOVEMENT_CARD_SCOPE_INVALID',
        'Cartao nao pertence a empresa ou nao esta ativo.',
        409,
      )
    }
  }
}

async function beginIdempotentOperation(
  client: PoolClient,
  tenantId: string,
  operation: string,
  key: string,
  requestHash: string,
): Promise<Record<string, unknown> | null> {
  await client.query(
    'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [tenantId, `${operation}:${key}`],
  )
  const existing = await client.query<{
    request_hash: string
    status: string
    response_body: Record<string, unknown> | null
  }>(
    `select request_hash, status, response_body
     from idempotency_keys
     where tenant_id = $1 and operation = $2 and idempotency_key = $3
     for update`,
    [tenantId, operation, key],
  )
  if (existing.rows[0]) {
    if (existing.rows[0].request_hash !== requestHash) {
      throw new CorporateFinanceServiceError(
        'CORPORATE_FINANCE_IDEMPOTENCY_CONFLICT',
        'A chave de idempotencia ja foi usada com outro conteudo.',
        409,
      )
    }
    if (existing.rows[0].status === 'completed') {
      return existing.rows[0].response_body || {}
    }
    throw new CorporateFinanceServiceError(
      'CORPORATE_FINANCE_OPERATION_IN_PROGRESS',
      'A operacao financeira ainda esta em processamento.',
      409,
    )
  }
  await client.query(
    `insert into idempotency_keys (
       tenant_id, operation, idempotency_key, request_hash, status,
       locked_until, expires_at
     ) values ($1, $2, $3, $4, 'processing', now() + interval '2 minutes',
               now() + interval '7 days')`,
    [tenantId, operation, key, requestHash],
  )
  return null
}

async function completeIdempotentOperation(
  client: PoolClient,
  tenantId: string,
  operation: string,
  key: string,
  response: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `update idempotency_keys
     set status = 'completed', response_status = 200,
         response_body = $4::jsonb, locked_until = null, updated_at = now()
     where tenant_id = $1 and operation = $2 and idempotency_key = $3`,
    [tenantId, operation, key, JSON.stringify(response)],
  )
}

function corporateFinanceCompanyIds(principal: RequestPrincipal): string[] {
  const permissionScoped = principal.corporateAccess?.companies
    .filter((company) => company.permissions.ver_financeiro)
    .map((company) => company.companyId)
  return permissionScoped || getAccessibleCompanyIds(principal)
}

function invoiceNumberFor(companyId: string, periodStart: string): string {
  const suffix = companyId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || 'EMPRESA'
  return `FAT-${periodStart.slice(0, 7).replace('-', '')}-${suffix}`
}

function staleVersion(entity: string, expected: number, current: number): CorporateFinanceServiceError {
  return new CorporateFinanceServiceError(
    'CORPORATE_FINANCE_STALE_VERSION',
    `A ${entity} foi alterada por outro usuario. Atualize antes de salvar.`,
    409,
    { expectedVersion: expected, currentVersion: current },
  )
}

function mergeUnresolved<T extends { id: string }>(unresolved: unknown[], items: T[]): unknown[] {
  const ids = new Set(items.map((item) => item.id))
  return [
    ...unresolved.filter((item) => {
      const id = item && typeof item === 'object' ? String((item as Record<string, unknown>).id || '') : ''
      return !id || !ids.has(id)
    }),
    ...items,
  ]
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function toIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new CorporateFinanceServiceError(
      'CORPORATE_FINANCE_DATE_INVALID',
      'Registro financeiro possui data invalida.',
      500,
    )
  }
  return date.toISOString()
}

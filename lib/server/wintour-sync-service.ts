import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import type { PoolClient } from 'pg'

import {
  buildWintourCreationXml,
  buildWintourUpdateXml,
  encodeWintourIso88591,
  WINTOUR_PAYMENT_METHODS,
  WintourXmlValidationError,
  type WintourCreationFile,
  type WintourUpdateFile,
} from '@/lib/integrations/wintour/wintour-xml'
import { writeAuditEventInTransaction } from '@/lib/server/audit-log'
import { queryDatabase, withTenantTransaction } from '@/lib/server/database'
import { getServerEnvironment } from '@/lib/server/environment'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  bindWintourSaleNumberInputSchema,
  claimWintourSyncJobsInputSchema,
  claimWintourPollJobsInputSchema,
  createWintourSaleAdjustmentInputSchema,
  discoverWintourSyncSalesInputSchema,
  prepareWintourSyncJobInputSchema,
  prepareReadyWintourSyncJobsInputSchema,
  reconcileWintourSyncJobInputSchema,
  recoverStaleWintourSyncJobsInputSchema,
  recordWintourSyncAttemptResultInputSchema,
  recordWintourSubmissionSuccessInputSchema,
  recordWintourPollResultInputSchema,
  recordWintourSyncProtocolInputSchema,
  retryWintourSyncJobInputSchema,
  wintourSyncDashboardFiltersSchema,
  wintourSyncSettingsInputSchema,
  type BindWintourSaleNumberInput,
  type ClaimedWintourSyncJob,
  type ClaimedWintourPollJob,
  type ClaimWintourSyncJobsInput,
  type ClaimWintourPollJobsInput,
  type CreateWintourSaleAdjustmentInput,
  type DiscoverWintourSyncSalesInput,
  type PrepareWintourSyncJobInput,
  type PrepareReadyWintourSyncJobsInput,
  type ReconcileWintourSyncJobInput,
  type RecoverStaleWintourSyncJobsInput,
  type RecordWintourSyncAttemptResultInput,
  type RecordWintourSubmissionSuccessInput,
  type RecordWintourPollResultInput,
  type RecordWintourSyncProtocolInput,
  type RetryWintourSyncJobInput,
  type WintourDiscoveryResult,
  type WintourPrepareReadyResult,
  type WintourSyncDashboard,
  type WintourSyncDashboardFilters,
  type WintourSyncJobSummary,
  type WintourSyncSettings,
  type WintourSyncSettingsInput,
  type WintourSyncJobArtifact,
  type WintourSyncState,
  type WintourSaleLinkSummary,
  type WintourWorkerTarget,
} from '@/lib/wintour-sync'

const WINTOUR_PROVIDER = 'wintour'
const WINTOUR_IDV_SEQUENCE = 'wintour-idv-externo'
const WINTOUR_FILE_SEQUENCE = 'wintour-file-number'
const WINTOUR_CREATION_SERIALIZER = 'wintour-creation-v4'
const WINTOUR_UPDATE_SERIALIZER = 'wintour-update-dgr046-v1'
const WINTOUR_GENERATION_TIME_ZONE = 'America/Sao_Paulo'
const WINTOUR_MAX_POLL_ATTEMPTS = 12
const WINTOUR_MAX_POLL_WINDOW_HOURS = 24
const WINTOUR_CP_ACCOUNT_METHODS = new Set(['CP', 'RP', 'VP', 'S5', 'S7', 'TR', 'VT', 'CM'])
const WINTOUR_MP_ACCOUNT_METHODS = new Set(['MP', 'FI', 'EP', 'EF', 'S6', 'TR', 'DM', 'CM', 'MF', '3F'])
const WINTOUR_SPLIT_PAYMENT_METHODS = new Set(['DM', 'CM', 'MF', '3F'])

interface SettingsRow {
  enabled: boolean
  sync_from: Date | string
  agency_name: string
  branch_id: number | string | null
  branch_name: string | null
  free_field: string | null
  product_codes: unknown
  payment_method_codes: unknown
  service_route_types: unknown
  tariff_net_default: number | string | null
  account_defaults: unknown
  customer_action: 'none' | 'I' | 'U' | 'IU'
  auto_send: boolean
  auto_poll: boolean
  max_attempts: number | string
  discovery_batch_size: number | string
  version: number | string
  updated_by?: string | null
  updated_at: Date | string
}

interface SaleLinkRow {
  id: string
  company_id: string
  emission_id: string
  source_item_key: string
  source_ticket_id: string | null
  idv_externo: number | string
  wintour_sale_number: number | string | null
  source_fingerprint: string
  source_snapshot: unknown
  state: WintourSyncState
  blocked_reasons: unknown
  version: number | string
  updated_at: Date | string
}

interface JobRow {
  id: string
  sale_link_id: string
  company_id?: string
  emission_id?: string
  operation: 'create' | 'update'
  source_fingerprint?: string
  link_source_fingerprint?: string
  config_fingerprint?: string
  source_snapshot?: unknown
  payload_bytes?: Buffer | Uint8Array | null
  payload_sha256?: string | null
  payload_filename?: string | null
  payload_content_type?: string | null
  serializer_version?: string | null
  transport_free_field?: string | null
  file_number?: number | string | null
  state: WintourSyncState
  attempt_count: number | string
  max_attempts: number | string
  last_error_code: string | null
  version: number | string
  prepared_at: Date | string
  updated_at: Date | string
  latest_protocol_code?: string | null
  latest_protocol_kind?: 'submission' | 'poll' | 'manual' | null
}

interface EmissionCandidateRow {
  id: string
  company_id: string
  provider: string
  provider_emission_id: string
  ticket_number: string | null
  status: string
  gross_amount: string
  tax_amount: string
  final_amount: string
  currency: string
  issued_by: string | null
  issued_at: Date | string
  emission_created_at: Date | string
  emission_updated_at: Date | string
  service_type: string
  reservation_id: string
  reservation_currency: string
  reservation_gross_amount: string
  reservation_tax_amount: string
  reservation_final_amount: string
  reservation_updated_at: Date | string
  demand_id: string
  demand_number: string
  demand_created_at: Date | string
  demand_updated_at: Date | string
  requester_name: string | null
  cost_center_code: string | null
  payment_method: string | null
  source_item_key: string
  source_ticket_id: string | null
  passenger_name: string | null
  source_ticket_number: string | null
  source_ticket_status: string | null
  ticket_currency: string | null
  ticket_issued_at: Date | string | null
  ticket_updated_at: Date | string | null
  issuing_airline_code: string | null
  issuing_airline_name: string | null
  birth_date_snapshot: Date | string | null
  traveler_name: string | null
  employee_department: string | null
  employee_registration_code: string | null
  ticket_count: number | string
  ticket_fare_amount_minor: number | string | null
  ticket_tax_amount_minor: number | string | null
  ticket_total_amount_minor: number | string | null
  tickets_fare_total_minor: number | string | null
  tickets_tax_total_minor: number | string | null
  tickets_total_minor: number | string | null
  non_issued_ticket_count: number | string | null
  air_locator: string | null
  air_currency: string | null
  air_fare_amount_minor: number | string | null
  air_tax_amount_minor: number | string | null
  air_rav_amount_minor: number | string | null
  air_rac_amount_minor: number | string | null
  air_total_amount_minor: number | string | null
  air_details_version: number | string | null
  air_details_updated_at: Date | string | null
  air_segments: unknown
  air_trip_type: string | null
  provider_company_id: string | null
  actor_mapping_count: number | string
  external_actor_code: string | null
  source_freshness_at: Date | string
  source_refresh_needed: boolean
}

interface PreparedArtifact {
  fileNumber: string
  bytes: Uint8Array
  sha256: string
  filename: string
  serializerVersion: string
  sourceSnapshot: Record<string, unknown>
}

interface CanonicalSaleResult {
  sale: WintourCreationFile['vendas'][number] | null
  blockers: string[]
}

export class WintourSyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WintourSyncError'
  }
}

export async function getWintourSyncDashboard(
  principal: RequestPrincipal,
  filtersInput: WintourSyncDashboardFilters = {},
): Promise<WintourSyncDashboard> {
  requireWintourPermission(principal)
  const filters = wintourSyncDashboardFiltersSchema.parse(filtersInput)
  const scope = companyScope(principal)
  const environment = getServerEnvironment()

  return withTenantTransaction(principal.tenantId, async (client) => {
    const settingsResult = await client.query<SettingsRow>(
      `select enabled, sync_from, agency_name, branch_id, branch_name, free_field,
              product_codes, payment_method_codes, service_route_types,
              tariff_net_default, account_defaults, customer_action,
              auto_send, auto_poll, max_attempts, discovery_batch_size, version, updated_at
       from wintour_sync_settings where tenant_id = $1`,
      [principal.tenantId],
    )
    const companyMappings = await loadCompanyMappings(client, principal.tenantId, scope)
    const availableCompanies = await client.query<{ id: string; name: string; customer_code: string | null }>(
      `select id, name, customer_code from companies
       where tenant_id = $1 and deleted_at is null
         and ($2::text[] is null or id = any($2::text[]))
       order by name, id`,
      [principal.tenantId, scope],
    )
    const counts = await client.query<{ state: WintourSyncState; total: number | string }>(
      `with latest_job as (
         select distinct on (job.sale_link_id)
                job.sale_link_id, job.operation, job.company_id, job.state
         from wintour_sync_jobs job
         where job.tenant_id = $1
         order by job.sale_link_id, job.prepared_at desc, job.id desc
       ), effective_sale as (
         select link.company_id, latest_job.operation,
                case
                  when link.state in ('blocked', 'manual_review') then link.state
                  when jsonb_array_length(link.blocked_reasons) > 0 then 'manual_review'
                  else coalesce(latest_job.state, link.state)
                end as state
         from wintour_sale_links link
         left join latest_job on latest_job.sale_link_id = link.id
         where link.tenant_id = $1
       )
       select state, count(*)::integer as total
       from effective_sale
       where ($2::text is null or state = $2)
         and ($3::text is null or operation = $3)
         and ($4::text is null or company_id = $4)
         and ($5::text[] is null or company_id = any($5::text[]))
       group by state`,
      [
        principal.tenantId, filters.state || null, filters.operation || null,
        filters.companyId || null, scope,
      ],
    )
    const links = await client.query<SaleLinkRow>(
      `select link.id, link.company_id, link.emission_id, link.source_item_key,
              link.source_ticket_id, link.idv_externo,
              link.wintour_sale_number, link.source_fingerprint, link.source_snapshot,
              link.state, link.blocked_reasons, link.version, link.updated_at
       from wintour_sale_links link
       where link.tenant_id = $1
         and ($2::text is null or link.state = $2)
         and ($3::text is null or link.company_id = $3)
         and ($5::text[] is null or link.company_id = any($5::text[]))
         and ($4::text is null or exists (
           select 1 from wintour_sync_jobs job
           where job.tenant_id = link.tenant_id and job.sale_link_id = link.id
             and job.operation = $4
         ))
       order by link.updated_at desc, link.id
       limit $6`,
      [
        principal.tenantId,
        filters.state || null,
        filters.companyId || null,
        filters.operation || null,
        scope,
        filters.limit,
      ],
    )
    const jobs = await client.query<JobRow>(
      `select job.id, job.sale_link_id, job.operation, job.state,
              job.attempt_count, job.max_attempts, job.last_error_code,
              job.version, job.prepared_at, job.updated_at,
              job.payload_bytes, protocol.protocol_code as latest_protocol_code,
              protocol.protocol_kind as latest_protocol_kind
       from wintour_sync_jobs job
       left join lateral (
         select protocol_code, protocol_kind
         from wintour_sync_protocols candidate
         where candidate.tenant_id = job.tenant_id and candidate.job_id = job.id
         order by candidate.observed_at desc, candidate.id desc limit 1
       ) protocol on true
       where job.tenant_id = $1
         and ($2::text is null or job.state = $2)
         and ($3::text is null or job.operation = $3)
         and ($4::text is null or job.company_id = $4)
         and ($5::text[] is null or job.company_id = any($5::text[]))
       order by job.updated_at desc, job.id
       limit $6`,
      [
        principal.tenantId, filters.state || null, filters.operation || null,
        filters.companyId || null, scope, filters.limit,
      ],
    )

    return {
      settings: settingsResult.rows[0] ? mapSettings(settingsResult.rows[0], companyMappings) : null,
      countsByState: Object.fromEntries(counts.rows.map((row) => [row.state, numberValue(row.total)])),
      saleLinks: links.rows.map(mapSaleLink),
      jobs: jobs.rows.map(mapJob),
      availableCompanies: availableCompanies.rows.map((company) => ({
        id: company.id,
        name: company.name,
        customerCode: company.customer_code,
      })),
      capabilities: {
        prepare: Boolean(settingsResult.rows[0]?.enabled),
        send: Boolean(settingsResult.rows[0]?.enabled
          && settingsResult.rows[0]?.auto_send
          && environment.WINTOUR_SYNC_ENABLED
          && environment.WINTOUR_AUTO_SEND
          && environment.WINTOUR_TENANT_ID === principal.tenantId
          && environment.WINTOUR_PIN?.trim()),
        poll: Boolean(settingsResult.rows[0]?.enabled
          && settingsResult.rows[0]?.auto_poll
          && environment.WINTOUR_SYNC_ENABLED
          && environment.WINTOUR_PROTOCOL_POLL_ENABLED
          && environment.WINTOUR_TENANT_ID === principal.tenantId
          && environment.WINTOUR_PIN?.trim()),
        reconcile: true,
        download: true,
      },
    }
  })
}

export async function updateWintourSyncSettings(
  principal: RequestPrincipal,
  input: WintourSyncSettingsInput,
): Promise<WintourSyncSettings> {
  requireSettingsPermission(principal)
  const values = wintourSyncSettingsInputSchema.parse(input)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const currentResult = await client.query<SettingsRow>(
      `select enabled, sync_from, agency_name, branch_id, branch_name, free_field,
              product_codes, payment_method_codes, service_route_types,
              tariff_net_default, account_defaults, customer_action,
              auto_send, auto_poll, max_attempts, discovery_batch_size, version, updated_at
       from wintour_sync_settings where tenant_id = $1 for update`,
      [principal.tenantId],
    )
    const current = currentResult.rows[0]
    let saved: SettingsRow | undefined

    if (!current) {
      if (values.expectedVersion !== null) throw versionConflict(values.expectedVersion, null)
      const inserted = await client.query<SettingsRow>(
        `insert into wintour_sync_settings (
           tenant_id, enabled, sync_from, agency_name, branch_id, branch_name,
           free_field, product_codes, payment_method_codes, service_route_types,
           tariff_net_default, account_defaults, customer_action, auto_send, auto_poll,
           max_attempts, discovery_batch_size,
           created_by, updated_by
         ) values (
           $1, $2, $3::timestamptz, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
           $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $18
         )
         returning enabled, sync_from, agency_name, branch_id, branch_name, free_field,
                   product_codes, payment_method_codes, service_route_types,
                   tariff_net_default, account_defaults, customer_action, auto_send, auto_poll,
                   max_attempts, discovery_batch_size, version, updated_at`,
        [
          principal.tenantId,
          values.enabled,
          values.syncFrom,
          values.agencyName,
          values.branchId,
          values.branchName,
          values.freeField,
          JSON.stringify(values.productCodes),
          JSON.stringify(values.paymentMethodCodes),
          JSON.stringify(values.serviceRouteTypes),
          values.tariffNetDefault,
          JSON.stringify(accountDefaultsToDatabase(values.accountDefaults)),
          values.customerAction,
          values.autoSend,
          values.autoPoll,
          values.maxAttempts,
          values.discoveryBatchSize,
          principal.user.id,
        ],
      )
      saved = inserted.rows[0]
    } else {
      if (values.expectedVersion !== numberValue(current.version)) {
        throw versionConflict(values.expectedVersion, numberValue(current.version))
      }
      const updated = await client.query<SettingsRow>(
        `update wintour_sync_settings
         set enabled = $2, sync_from = $3::timestamptz, agency_name = $4,
             branch_id = $5, branch_name = $6, free_field = $7,
             product_codes = $8::jsonb, payment_method_codes = $9::jsonb,
             service_route_types = $10::jsonb, tariff_net_default = $11,
             account_defaults = $12::jsonb, customer_action = $13,
             auto_send = $14, auto_poll = $15, max_attempts = $16,
             discovery_batch_size = $17, updated_by = $18, version = version + 1
         where tenant_id = $1 and version = $19
         returning enabled, sync_from, agency_name, branch_id, branch_name, free_field,
                   product_codes, payment_method_codes, service_route_types,
                   tariff_net_default, account_defaults, customer_action, auto_send, auto_poll,
                   max_attempts, discovery_batch_size, version, updated_at`,
        [
          principal.tenantId,
          values.enabled,
          values.syncFrom,
          values.agencyName,
          values.branchId,
          values.branchName,
          values.freeField,
          JSON.stringify(values.productCodes),
          JSON.stringify(values.paymentMethodCodes),
          JSON.stringify(values.serviceRouteTypes),
          values.tariffNetDefault,
          JSON.stringify(accountDefaultsToDatabase(values.accountDefaults)),
          values.customerAction,
          values.autoSend,
          values.autoPoll,
          values.maxAttempts,
          values.discoveryBatchSize,
          principal.user.id,
          values.expectedVersion,
        ],
      )
      saved = updated.rows[0]
      if (!saved) throw versionConflict(values.expectedVersion, null)
    }

    await replaceCompanyMappings(client, principal, values.companyMappings)
    const companyMappings = await loadCompanyMappings(client, principal.tenantId)
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.settings.update',
      entityType: 'wintour_sync_settings',
      entityId: principal.tenantId,
      metadata: {
        previousVersion: current ? numberValue(current.version) : null,
        version: numberValue(saved.version),
        enabled: saved.enabled,
        syncFrom: iso(saved.sync_from),
      },
    })
    return mapSettings(saved, companyMappings)
  })
}

export async function getWintourSyncJobArtifact(
  principal: RequestPrincipal,
  input: { jobId: string },
): Promise<WintourSyncJobArtifact> {
  requireWintourPermission(principal)
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.jobId)) {
    throw notFound('job')
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{
      id: string
      company_id: string
      operation: 'create' | 'update'
      payload_bytes: Buffer | Uint8Array | null
      payload_sha256: string | null
      payload_filename: string | null
      payload_content_type: string | null
      serializer_version: string | null
    }>(
      `select id, company_id, operation, payload_bytes, payload_sha256,
              payload_filename, payload_content_type, serializer_version
       from wintour_sync_jobs where tenant_id = $1 and id = $2`,
      [principal.tenantId, input.jobId],
    )
    const job = result.rows[0]
    if (!job) throw notFound('job')
    assertCompanyAccess(principal, job.company_id)
    if (!job.payload_bytes || !job.payload_sha256 || !job.payload_filename
        || job.payload_content_type !== 'application/xml' || !job.serializer_version) {
      throw new WintourSyncError(
        'WINTOUR_JOB_ARTIFACT_UNAVAILABLE',
        'O job ainda nao possui artefato XML preparado.',
        409,
      )
    }
    const bytes = Uint8Array.from(job.payload_bytes)
    if (createHash('sha256').update(bytes).digest('hex') !== job.payload_sha256) {
      throw new WintourSyncError(
        'WINTOUR_JOB_ARTIFACT_CORRUPT',
        'O artefato persistido falhou na verificacao de integridade.',
        500,
      )
    }
    return {
      jobId: job.id,
      operation: job.operation,
      filename: job.payload_filename,
      contentType: 'application/xml',
      bytes,
      sha256: job.payload_sha256,
      serializerVersion: job.serializer_version,
    }
  })
}

export async function discoverWintourSyncSales(
  principal: RequestPrincipal,
  input: DiscoverWintourSyncSalesInput,
): Promise<WintourDiscoveryResult> {
  requireWintourPermission(principal)
  const values = discoverWintourSyncSalesInputSchema.parse(input)
  const scope = companyScope(principal)
  const effectiveCompanyIds = scope === null
    ? values.companyIds || null
    : values.companyIds
      ? values.companyIds.filter((id) => scope.includes(id))
      : scope

  return withTenantTransaction(principal.tenantId, async (client) => {
    const settingsResult = await client.query<SettingsRow>(
      `select enabled, sync_from, agency_name, branch_id, branch_name, free_field,
              product_codes, payment_method_codes, service_route_types,
              tariff_net_default, account_defaults, customer_action, auto_send, auto_poll,
              max_attempts, discovery_batch_size, version, updated_at
       from wintour_sync_settings where tenant_id = $1 for update`,
      [principal.tenantId],
    )
    const settings = settingsResult.rows[0]
    if (!settings) {
      throw new WintourSyncError(
        'WINTOUR_SYNC_SETTINGS_REQUIRED',
        'Configure a sincronizacao Wintour antes da descoberta.',
        409,
      )
    }
    const limit = Math.min(values.limit || numberValue(settings.discovery_batch_size), 500)
    const candidates = await client.query<EmissionCandidateRow>(
      `select emission.id, emission.company_id, emission.provider,
              emission.provider_emission_id, emission.ticket_number, emission.status,
              emission.gross_amount::text, emission.tax_amount::text,
              emission.final_amount::text, emission.currency, emission.issued_by,
              emission.issued_at, emission.created_at as emission_created_at,
              emission.updated_at as emission_updated_at,
              reservation.service_type, reservation.id as reservation_id,
              reservation.currency as reservation_currency,
              reservation.gross_amount::text as reservation_gross_amount,
              reservation.tax_amount::text as reservation_tax_amount,
              reservation.final_amount::text as reservation_final_amount,
              reservation.updated_at as reservation_updated_at,
              demand.id as demand_id, demand.demand_number,
              demand.created_at as demand_created_at,
              demand.updated_at as demand_updated_at,
              case when requester.deleted_at is null then requester.name end as requester_name,
              case when cost_center.deleted_at is null then cost_center.code end as cost_center_code,
              emission.metadata #>> '{payment,method}' as payment_method,
              case when ticket.id is null then 'emission' else 'air-ticket:' || ticket.id::text end
                as source_item_key,
              ticket.id as source_ticket_id, ticket.passenger_name,
              ticket.ticket_number as source_ticket_number,
              ticket.status as source_ticket_status,
              ticket.currency as ticket_currency, ticket.issued_at as ticket_issued_at,
              ticket.updated_at as ticket_updated_at,
              ticket.issuing_airline_code, ticket.issuing_airline_name,
              case when traveler.deleted_at is null then traveler.birth_date_snapshot end
                as birth_date_snapshot,
              case when traveler.deleted_at is null then traveler.name_snapshot end
                as traveler_name,
              case when employee.deleted_at is null then employee.department end
                as employee_department,
              case when employee.deleted_at is null then employee.registration_code end
                as employee_registration_code,
              ticket_stats.ticket_count,
              ticket.fare_amount_minor as ticket_fare_amount_minor,
              ticket.tax_amount_minor as ticket_tax_amount_minor,
              ticket.total_amount_minor as ticket_total_amount_minor,
              ticket_stats.fare_total_minor as tickets_fare_total_minor,
              ticket_stats.tax_total_minor as tickets_tax_total_minor,
              ticket_stats.total_minor as tickets_total_minor,
              ticket_stats.non_issued_ticket_count,
              air.locator as air_locator, air.currency as air_currency,
              air.fare_amount_minor as air_fare_amount_minor,
              air.tax_amount_minor as air_tax_amount_minor,
              air.rav_amount_minor as air_rav_amount_minor,
              air.rac_amount_minor as air_rac_amount_minor,
              air.total_amount_minor as air_total_amount_minor,
              air.version as air_details_version,
              air.updated_at as air_details_updated_at,
              route.air_segments, air_demand.trip_type as air_trip_type,
              company_mapping.provider_company_id,
              actor_mapping.mapping_count as actor_mapping_count,
              actor_mapping.external_actor_code,
              wintour_sale_source_freshness_at(
                emission.tenant_id, emission.id, ticket.id, emission.company_id
              ) as source_freshness_at,
              coalesce(wintour_sale_source_freshness_at(
                emission.tenant_id, emission.id, ticket.id, emission.company_id
              ), 'infinity'::timestamptz) > coalesce(
                discovered_link.source_refreshed_at,
                '-infinity'::timestamptz
              ) as source_refresh_needed
       from travel_emissions emission
       join reservations reservation
         on reservation.tenant_id = emission.tenant_id and reservation.id = emission.reservation_id
       join demands demand
         on demand.tenant_id = emission.tenant_id and demand.id = emission.demand_id
        and demand.company_id = emission.company_id and demand.id = reservation.demand_id
       left join requesters requester
         on requester.tenant_id = demand.tenant_id and requester.id = demand.requester_id
        and requester.company_id = demand.company_id
       left join cost_centers cost_center
         on cost_center.tenant_id = demand.tenant_id and cost_center.id = demand.cost_center_id
        and cost_center.company_id = demand.company_id
       left join air_emission_tickets ticket
         on ticket.tenant_id = emission.tenant_id and ticket.emission_id = emission.id
        and reservation.service_type = 'aereo'
       left join demand_travelers traveler
         on traveler.tenant_id = ticket.tenant_id and traveler.id = ticket.demand_traveler_id
        and traveler.demand_id = demand.id
       left join employees employee
         on employee.tenant_id = traveler.tenant_id and employee.id = traveler.employee_id
        and employee.company_id = demand.company_id
       left join air_reservation_details air
         on air.tenant_id = reservation.tenant_id and air.reservation_id = reservation.id
       left join air_demand_details air_demand
         on air_demand.tenant_id = demand.tenant_id and air_demand.demand_id = demand.id
       left join lateral (
         select jsonb_agg(jsonb_build_object(
                  'id', segment.id,
                  'sequence', segment.sequence,
                  'airlineCode', segment.airline_code,
                  'flightNumber', segment.flight_number,
                  'bookingClass', segment.booking_class,
                  'status', segment.status,
                  'originCode', segment.origin_code,
                  'destinationCode', segment.destination_code,
                  'departsAt', segment.departs_at,
                  'arrivesAt', segment.arrives_at,
                  'updatedAt', segment.updated_at,
                  'originTimezone', origin_airport.timezone,
                  'originCountryCode', origin_airport.country_code,
                  'destinationTimezone', destination_airport.timezone,
                  'destinationCountryCode', destination_airport.country_code
                ) order by segment.sequence) as air_segments,
                greatest(
                  max(segment.updated_at),
                  max(origin_airport.max_updated_at),
                  max(destination_airport.max_updated_at)
                ) as max_updated_at
         from air_reservation_segments segment
         left join lateral (
           select case when count(*) > 0 and count(*) = count(airport.timezone)
                            and count(distinct airport.timezone) = 1
                    then min(airport.timezone) end as timezone,
                  case when count(*) > 0 and count(*) = count(airport.country_code)
                            and count(distinct upper(airport.country_code::text)) = 1
                    then min(upper(airport.country_code::text)) end as country_code,
                  max(airport.updated_at) as max_updated_at
           from geo_airports airport
           where airport.is_active and upper(airport.iata_code::text) = segment.origin_code
         ) origin_airport on true
         left join lateral (
           select case when count(*) > 0 and count(*) = count(airport.timezone)
                            and count(distinct airport.timezone) = 1
                    then min(airport.timezone) end as timezone,
                  case when count(*) > 0 and count(*) = count(airport.country_code)
                            and count(distinct upper(airport.country_code::text)) = 1
                    then min(upper(airport.country_code::text)) end as country_code,
                  max(airport.updated_at) as max_updated_at
           from geo_airports airport
           where airport.is_active and upper(airport.iata_code::text) = segment.destination_code
         ) destination_airport on true
         where segment.tenant_id = reservation.tenant_id
           and segment.reservation_id = reservation.id
       ) route on true
       left join lateral (
         select count(*)::integer as ticket_count,
                sum(item.fare_amount_minor)::bigint as fare_total_minor,
                sum(item.tax_amount_minor)::bigint as tax_total_minor,
                sum(item.total_amount_minor)::bigint as total_minor,
                count(*) filter (where item.status <> 'issued')::integer
                  as non_issued_ticket_count,
                max(item.updated_at) as max_updated_at
         from air_emission_tickets item
         where item.tenant_id = emission.tenant_id and item.emission_id = emission.id
       ) ticket_stats on true
       left join integration_company_mappings company_mapping
         on company_mapping.tenant_id = emission.tenant_id
        and company_mapping.company_id = emission.company_id
        and company_mapping.provider = $2
        and company_mapping.mapping_type = 'provider_company'
        and company_mapping.status = 'active'
       left join lateral (
         select count(*)::integer as mapping_count,
                case when count(*) = 1 then min(mapping.external_actor_code) end
                  as external_actor_code,
                max(mapping.updated_at) as mapping_updated_at
         from integration_actor_mappings mapping
         where mapping.tenant_id = emission.tenant_id
           and mapping.provider_key = $2
           and mapping.user_id = emission.issued_by
           and mapping.status = 'active'
       ) actor_mapping on true
       left join wintour_sale_links discovered_link
         on discovered_link.tenant_id = emission.tenant_id
        and discovered_link.emission_id = emission.id
        and discovered_link.source_item_key = case
          when ticket.id is null then 'emission'
          else 'air-ticket:' || ticket.id::text
        end
       where emission.tenant_id = $1
         and emission.issued_at >= $3::timestamptz
         and emission.provider = 'manual-offline'
         and lower(emission.provider) <> $2
         and lower(coalesce(emission.metadata ->> 'source', '')) not in ('wintour', 'wintour_import')
         and (reservation.service_type <> 'aereo' or ticket.id is not null)
         and ($4::text[] is null or emission.company_id = any($4::text[]))
       order by (discovered_link.id is null) desc,
                source_refresh_needed desc,
                emission.issued_at, emission.id, source_item_key
       limit $5`,
      [
        principal.tenantId,
        WINTOUR_PROVIDER,
        iso(settings.sync_from),
        effectiveCompanyIds,
        limit,
      ],
    )

    const result: WintourDiscoveryResult = {
      scanned: candidates.rows.length,
      created: 0,
      refreshed: 0,
      ready: 0,
      blocked: 0,
    }

    for (const candidate of candidates.rows) {
      const canonicalSale = buildCanonicalSale(candidate, settings)
      const blockedReasons = discoveryBlockers(candidate, settings, canonicalSale.blockers)
      const snapshot = emissionSnapshot(candidate, canonicalSale.sale)
      const sourceFingerprint = fingerprint(emissionSourceFingerprint(candidate))
      const existingResult = await client.query<SaleLinkRow>(
        `select id, company_id, emission_id, source_item_key, source_ticket_id,
                idv_externo, wintour_sale_number,
                source_fingerprint, source_snapshot, state, blocked_reasons, version, updated_at
         from wintour_sale_links
         where tenant_id = $1 and emission_id = $2 and source_item_key = $3 for update`,
        [principal.tenantId, candidate.id, candidate.source_item_key],
      )
      const existing = existingResult.rows[0]

      if (!existing) {
        const idvExterno = await nextTenantNumber(client, principal.tenantId, WINTOUR_IDV_SEQUENCE)
        const state: WintourSyncState = blockedReasons.length ? 'blocked' : 'ready'
        await client.query(
           `insert into wintour_sale_links (
             tenant_id, company_id, emission_id, source_item_key, source_ticket_id,
             idv_externo, source_fingerprint, source_refreshed_at,
             source_snapshot, state, blocked_reasons, created_by, updated_by
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8::timestamptz,
             $9::jsonb, $10, $11::jsonb, $12, $12
           )`,
          [
            principal.tenantId,
            candidate.company_id,
            candidate.id,
            candidate.source_item_key,
            candidate.source_ticket_id,
             idvExterno,
             sourceFingerprint,
             iso(candidate.source_freshness_at),
             JSON.stringify(snapshot),
             state,
             JSON.stringify(blockedReasons),
            principal.user.id,
          ],
        )
        result.created += 1
        if (state === 'ready') result.ready += 1
        else result.blocked += 1
        continue
      }

      const sourceChanged = existing.source_fingerprint !== sourceFingerprint
      const snapshotChanged = canonical(existing.source_snapshot) !== canonical(snapshot)
      let state = existing.state
      let effectiveBlockers = blockedReasons
      if (sourceChanged && existing.wintour_sale_number !== null) {
        state = 'manual_review'
        effectiveBlockers = uniqueStrings([...blockedReasons, 'source_changed_after_wintour_link'])
      } else if (['sending', 'ambiguous', 'received', 'processing', 'manual_review'].includes(existing.state)) {
        if (sourceChanged) {
          state = 'manual_review'
          effectiveBlockers = uniqueStrings([...blockedReasons, 'source_changed_in_flight'])
        } else {
          effectiveBlockers = stringArray(existing.blocked_reasons)
        }
      } else if (!sourceChanged && ['completed', 'rejected', 'failed'].includes(existing.state)) {
        effectiveBlockers = stringArray(existing.blocked_reasons)
      } else {
        state = blockedReasons.length ? 'blocked' : 'ready'
      }

      const changed = sourceChanged
        || snapshotChanged
        || state !== existing.state
        || canonical(effectiveBlockers) !== canonical(stringArray(existing.blocked_reasons))
      if (changed) {
        const updated = await client.query(
          `update wintour_sale_links
           set source_fingerprint = $3, source_snapshot = $4::jsonb,
               state = $5, blocked_reasons = $6::jsonb,
               source_refreshed_at = $7::timestamptz,
               updated_by = $8, version = version + 1
            where tenant_id = $1 and id = $2 and version = $9
           returning id`,
          [
            principal.tenantId,
            existing.id,
            sourceFingerprint,
            JSON.stringify(snapshot),
             state,
             JSON.stringify(effectiveBlockers),
             iso(candidate.source_freshness_at),
             principal.user.id,
             numberValue(existing.version),
          ],
        )
        if (!updated.rows[0]) throw versionConflict(numberValue(existing.version), null)
        result.refreshed += 1
      } else if (candidate.source_refresh_needed) {
        const observed = await client.query(
           `update wintour_sale_links
            set source_refreshed_at = $4::timestamptz
            where tenant_id = $1 and id = $2 and version = $3
            returning id`,
           [
             principal.tenantId,
             existing.id,
             numberValue(existing.version),
             iso(candidate.source_freshness_at),
           ],
        )
        if (!observed.rows[0]) throw versionConflict(numberValue(existing.version), null)
      }
      if (state === 'ready') result.ready += 1
      if (state === 'blocked' || state === 'manual_review') result.blocked += 1
    }

    if (result.created > 0 || result.refreshed > 0) {
      await auditInTransaction(client, principal, {
        action: 'integration.wintour_sync.discover',
        entityType: 'wintour_sync_settings',
        entityId: principal.tenantId,
        metadata: { ...result },
      })
    }
    return result
  })
}

export async function prepareWintourSyncJob(
  principal: RequestPrincipal,
  input: PrepareWintourSyncJobInput,
): Promise<WintourSyncJobSummary> {
  requireWintourPermission(principal)
  const values = prepareWintourSyncJobInputSchema.parse(input)
  if (values.operation === 'update') {
    throw new WintourSyncError(
      'WINTOUR_UPDATE_ADJUSTMENT_REQUIRED',
      'Atualizacoes exigem um ajuste manual allowlisted; nao sao inferidas da emissao.',
      422,
    )
  }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const settings = await requireEnabledSettings(client, principal.tenantId)
    const link = await lockSaleLink(client, principal.tenantId, values.saleLinkId)
    assertCompanyAccess(principal, link.company_id)
    const linkSnapshot = objectValue(link.source_snapshot)
    const liveMappings = await loadCurrentSaleMappings(client, principal.tenantId, link)
    const configSnapshot = preparationConfiguration(settings, 'create', {
      ...linkSnapshot,
      mappings: liveMappings,
    })
    const configFingerprint = fingerprint(configSnapshot)
    const jobSourceFingerprint = fingerprint({
      linkSourceFingerprint: link.source_fingerprint,
      configFingerprint,
      operation: 'create',
    })
    const idempotencyKey = fingerprint({
      tenantId: principal.tenantId,
      saleLinkId: link.id,
      operation: 'create',
      sourceFingerprint: jobSourceFingerprint,
    })
    const replay = await findJobByIdempotencyKey(client, principal.tenantId, idempotencyKey)
    if (replay) return mapJob(replay)
    assertVersion(numberValue(link.version), values.expectedVersion)
    if (link.wintour_sale_number !== null) {
      throw new WintourSyncError(
        'WINTOUR_CREATE_ALREADY_LINKED',
        'A venda ja possui numero Wintour; use um ajuste manual para atualizar.',
        409,
      )
    }
    if (link.state !== 'ready' || stringArray(link.blocked_reasons).length) {
      throw new WintourSyncError(
        'WINTOUR_SALE_NOT_READY',
        'A venda possui bloqueios antes da preparacao.',
        409,
        { state: link.state, blockedReasons: stringArray(link.blocked_reasons) },
      )
    }
    await assertNoActiveJob(client, principal.tenantId, link.id)

    const fileNumber = await nextTenantNumber(client, principal.tenantId, WINTOUR_FILE_SEQUENCE)
    const artifact = buildPreparedArtifact({
      operation: 'create', settings, link,
      sourceSnapshot: linkSnapshot, configSnapshot, fileNumber,
      generationAt: new Date(),
    })
    const job = await insertPreparedJob(client, principal, {
      link,
      operation: 'create',
      linkSourceFingerprint: link.source_fingerprint,
      configFingerprint,
      sourceFingerprint: jobSourceFingerprint,
      sourceSnapshot: artifact.sourceSnapshot,
      idempotencyKey,
      maxAttempts: numberValue(settings.max_attempts),
      artifact,
    })
    await bumpLinkReady(client, principal, link)
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.job.prepare',
      entityType: 'wintour_sync_job',
      entityId: job.id,
      metadata: { saleLinkId: link.id, operation: 'create' },
    })
    return mapJob(job)
  })
}

export async function createWintourSaleAdjustment(
  principal: RequestPrincipal,
  input: CreateWintourSaleAdjustmentInput,
): Promise<WintourSyncJobSummary> {
  requireWintourPermission(principal)
  const values = createWintourSaleAdjustmentInputSchema.parse(input)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const settings = await requireEnabledSettings(client, principal.tenantId)
    const link = await lockSaleLink(client, principal.tenantId, values.saleLinkId)
    assertCompanyAccess(principal, link.company_id)
    assertVersion(numberValue(link.version), values.expectedVersion)
    if (link.wintour_sale_number === null) {
      throw new WintourSyncError(
        'WINTOUR_UPDATE_SALE_NUMBER_REQUIRED',
        'Ajustes exigem o numero da venda Wintour previamente vinculado.',
        409,
      )
    }
    await assertNoActiveJob(client, principal.tenantId, link.id)

    const snapshot = {
      sourceKind: 'manual_adjustment',
      saleLinkId: link.id,
      emissionId: link.emission_id,
      companyId: link.company_id,
      idvExterno: String(link.idv_externo),
      wintourSaleNumber: String(link.wintour_sale_number),
      reason: values.reason,
      requestedBy: principal.user.id,
      recalculateCalculatedFields: values.recalculateCalculatedFields,
      changes: values.changes,
    }
    const configSnapshot = preparationConfiguration(
      settings,
      'update',
      objectValue(link.source_snapshot),
    )
    const configFingerprint = fingerprint(configSnapshot)
    const adjustmentFingerprint = fingerprint(snapshot)
    const sourceFingerprint = fingerprint({
      linkSourceFingerprint: link.source_fingerprint,
      configFingerprint,
      adjustmentFingerprint,
      operation: 'update',
    })
    const idempotencyKey = fingerprint({
      tenantId: principal.tenantId,
      saleLinkId: link.id,
      operation: 'update',
      sourceFingerprint,
    })
    const replay = await findJobByIdempotencyKey(client, principal.tenantId, idempotencyKey)
    if (replay) return mapJob(replay)
    const fileNumber = await nextTenantNumber(client, principal.tenantId, WINTOUR_FILE_SEQUENCE)
    const artifact = buildPreparedArtifact({
      operation: 'update', settings, link, sourceSnapshot: snapshot, configSnapshot, fileNumber,
      generationAt: new Date(),
    })
    const job = await insertPreparedJob(client, principal, {
      link,
      operation: 'update',
      linkSourceFingerprint: link.source_fingerprint,
      configFingerprint,
      sourceFingerprint,
      sourceSnapshot: artifact.sourceSnapshot,
      idempotencyKey,
      maxAttempts: numberValue(settings.max_attempts),
      artifact,
    })
    await bumpLinkReady(client, principal, link)
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.adjustment.create',
      entityType: 'wintour_sync_job',
      entityId: job.id,
      metadata: {
        saleLinkId: link.id,
        reason: values.reason,
        fields: values.changes.map((change) => change.field),
        recalculateCalculatedFields: values.recalculateCalculatedFields,
      },
    })
    return mapJob(job)
  })
}

export async function prepareReadyWintourSyncJobs(
  principal: RequestPrincipal,
  input: PrepareReadyWintourSyncJobsInput = {},
): Promise<WintourPrepareReadyResult> {
  requireWorkerPermission(principal)
  const values = prepareReadyWintourSyncJobsInputSchema.parse(input)
  const candidates = await withTenantTransaction(principal.tenantId, async (client) => {
    await requireEnabledSettings(client, principal.tenantId)
    const result = await client.query<{
      id: string
      version: number | string
      source_fingerprint: string
      replay_exists: boolean
    }>(
      `select link.id, link.version, link.source_fingerprint,
              false as replay_exists
       from wintour_sale_links link
       where link.tenant_id = $1 and link.state = 'ready'
         and link.wintour_sale_number is null
         and jsonb_array_length(link.blocked_reasons) = 0
         and not exists (
           select 1 from wintour_sync_jobs job
           where job.tenant_id = link.tenant_id and job.sale_link_id = link.id
             and job.operation = 'create'
             and job.state in (
               'ready', 'sending', 'ambiguous', 'received', 'processing', 'manual_review'
             )
         )
       order by link.updated_at, link.id
       limit $2`,
      [principal.tenantId, values.limit],
    )
    return result.rows
  })
  const result: WintourPrepareReadyResult = {
    scanned: candidates.length,
    prepared: 0,
    replayed: 0,
    blocked: 0,
  }
  for (const candidate of candidates) {
    try {
      await prepareWintourSyncJob(principal, {
        saleLinkId: candidate.id,
        expectedVersion: numberValue(candidate.version),
        operation: 'create',
      })
      if (candidate.replay_exists) result.replayed += 1
      else result.prepared += 1
    } catch (error) {
      if (!(error instanceof WintourSyncError)
          || ![
            'WINTOUR_CREATION_PAYLOAD_INCOMPLETE',
            'WINTOUR_CREATION_MAPPING_INCOMPLETE',
            'WINTOUR_CREATION_DATE_INVALID',
            'WINTOUR_ARTIFACT_XML_INVALID',
          ].includes(error.code)) {
        throw error
      }
      await withTenantTransaction(principal.tenantId, async (client) => {
        const updated = await client.query(
          `update wintour_sale_links
           set state = 'blocked', blocked_reasons = $3::jsonb,
               updated_by = $4, version = version + 1
           where tenant_id = $1 and id = $2 and version = $5 and state = 'ready'
           returning id`,
          [
            principal.tenantId,
            candidate.id,
            JSON.stringify([error.details?.blockedReason || 'artifact_preparation_failed']),
            principal.user.id,
            numberValue(candidate.version),
          ],
        )
        if (updated.rows[0]) {
          await auditInTransaction(client, principal, {
            action: 'integration.wintour_sync.job.block',
            entityType: 'wintour_sale_link',
            entityId: candidate.id,
            metadata: { code: error.code },
          })
        }
      })
      result.blocked += 1
    }
  }
  return result
}

export async function bindWintourSaleNumber(
  principal: RequestPrincipal,
  input: BindWintourSaleNumberInput,
): Promise<WintourSaleLinkSummary> {
  requireWintourPermission(principal)
  const values = bindWintourSaleNumberInputSchema.parse(input)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const link = await lockSaleLink(client, principal.tenantId, values.saleLinkId)
    assertCompanyAccess(principal, link.company_id)
    assertVersion(numberValue(link.version), values.expectedVersion)
    if (link.wintour_sale_number !== null) {
      if (String(link.wintour_sale_number) !== values.wintourSaleNumber) {
        throw new WintourSyncError(
          'WINTOUR_SALE_NUMBER_IMMUTABLE',
          'O numero Wintour ja foi vinculado e nao pode ser substituido.',
          409,
        )
      }
      return mapSaleLink(link)
    }

    const nextState = link.state === 'ambiguous' ? 'received' : link.state
    const updated = await client.query<SaleLinkRow>(
      `update wintour_sale_links
       set wintour_sale_number = $3::bigint, state = $4, updated_by = $5,
           version = version + 1
       where tenant_id = $1 and id = $2 and version = $6
       returning id, company_id, emission_id, source_item_key, source_ticket_id,
                 idv_externo, wintour_sale_number,
                 source_fingerprint, source_snapshot, state, blocked_reasons,
                 version, updated_at`,
      [
        principal.tenantId,
        link.id,
        values.wintourSaleNumber,
        nextState,
        principal.user.id,
        values.expectedVersion,
      ],
    )
    if (!updated.rows[0]) throw versionConflict(values.expectedVersion, null)
    const ambiguousJob = await client.query<{ id: string; version: number | string }>(
      `select id, version from wintour_sync_jobs
       where tenant_id = $1 and sale_link_id = $2 and state = 'ambiguous'
       order by updated_at desc, id desc limit 1 for update`,
      [principal.tenantId, link.id],
    )
    if (ambiguousJob.rows[0]) {
      const resolved = await client.query(
        `update wintour_sync_jobs
         set state = 'received', updated_by = $3, version = version + 1
         where tenant_id = $1 and id = $2 and version = $4 and state = 'ambiguous'
         returning id`,
        [
          principal.tenantId,
          ambiguousJob.rows[0].id,
          principal.user.id,
          numberValue(ambiguousJob.rows[0].version),
        ],
      )
      if (!resolved.rows[0]) throw versionConflict(numberValue(ambiguousJob.rows[0].version), null)
    }
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.sale_number.bind',
      entityType: 'wintour_sale_link',
      entityId: link.id,
      metadata: { wintourSaleNumber: values.wintourSaleNumber, reason: values.reason },
    })
    return mapSaleLink(updated.rows[0])
  })
}

export async function listWintourWorkerTargets(): Promise<WintourWorkerTarget[]> {
  const tenants = await queryDatabase<{ id: string }>(
    `select id from tenants where status in ('active', 'trial') order by id`,
  )
  const targets: WintourWorkerTarget[] = []
  for (const tenant of tenants.rows) {
    const target = await withTenantTransaction(tenant.id, async (client) => {
      const result = await client.query<{
        tenant_id: string
        auto_send: boolean
        auto_poll: boolean
        updated_by: string | null
      }>(
        `select tenant_id, auto_send, auto_poll, updated_by from wintour_sync_settings
         where tenant_id = $1 and enabled = true`,
        [tenant.id],
      )
      return result.rows[0] || null
    })
    if (target) targets.push({
      tenantId: target.tenant_id,
      enabled: true,
      autoSend: target.auto_send,
      autoPoll: target.auto_poll,
      updatedBy: target.updated_by,
    })
  }
  return targets
}

export async function recoverStaleWintourSyncJobs(
  principal: RequestPrincipal,
  input: RecoverStaleWintourSyncJobsInput = {},
): Promise<{ recovered: number; jobIds: string[] }> {
  requireWorkerPermission(principal)
  const values = recoverStaleWintourSyncJobsInputSchema.parse(input)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const stale = await client.query<{
      id: string
      sale_link_id: string
      lease_token: string
      version: number | string
      link_version: number | string
      link_source_fingerprint: string
      current_link_source_fingerprint: string
    }>(
       `select job.id, job.sale_link_id, job.lease_token, job.version,
               link.version as link_version, job.link_source_fingerprint,
               link.source_fingerprint as current_link_source_fingerprint
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       where job.tenant_id = $1 and job.state = 'sending'
         and job.lease_expires_at <= now()
       order by job.lease_expires_at, job.id
       for update of job, link skip locked
       limit $2`,
      [principal.tenantId, values.limit],
    )
    const jobIds: string[] = []
    for (const job of stale.rows) {
      const updated = await client.query(
        `update wintour_sync_jobs
         set state = 'ambiguous', lease_token = null, lease_expires_at = null,
             last_error_code = 'LEASE_EXPIRED_OUTCOME_UNKNOWN',
             last_error_message = 'Resultado externo desconhecido; reconciliacao obrigatoria.',
             updated_by = $3, version = version + 1
         where tenant_id = $1 and id = $2 and version = $4
           and state = 'sending' and lease_token = $5
         returning id`,
        [principal.tenantId, job.id, principal.user.id, numberValue(job.version), job.lease_token],
      )
      if (!updated.rows[0]) continue
      await client.query(
        `update wintour_sync_attempts
         set state = 'ambiguous', error_code = 'LEASE_EXPIRED_OUTCOME_UNKNOWN',
             error_message = 'Resultado externo desconhecido; reconciliacao obrigatoria.',
             finished_at = now(), version = version + 1
         where tenant_id = $1 and job_id = $2 and lease_token = $3 and state = 'sending'`,
        [principal.tenantId, job.id, job.lease_token],
      )
      await client.query(
        `update wintour_sale_links
         set state = 'ambiguous', updated_by = $3, version = version + 1
         where tenant_id = $1 and id = $2 and version = $4 and state = 'sending'
           and source_fingerprint = $5
         returning id`,
        [
          principal.tenantId,
          job.sale_link_id,
          principal.user.id,
          numberValue(job.link_version),
          job.link_source_fingerprint,
        ],
      )
      jobIds.push(job.id)
    }
    if (jobIds.length) {
      await auditInTransaction(client, principal, {
        action: 'integration.wintour_sync.jobs.recover_stale',
        entityType: 'wintour_sync_job',
        entityId: null,
        metadata: { count: jobIds.length, jobIds },
      })
    }
    return { recovered: jobIds.length, jobIds }
  })
}

export async function retryWintourSyncJob(
  principal: RequestPrincipal,
  input: RetryWintourSyncJobInput,
): Promise<WintourSyncJobSummary> {
  requireWintourPermission(principal)
  const values = retryWintourSyncJobInputSchema.parse(input)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const locked = await client.query<JobRow & { link_version: number | string }>(
      `select job.id, job.sale_link_id, job.company_id, job.operation, job.state,
              job.attempt_count, job.max_attempts, job.last_error_code,
              job.version, job.prepared_at, job.updated_at, job.payload_bytes,
              link.version as link_version
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       where job.tenant_id = $1 and job.id = $2
       for update of job, link`,
      [principal.tenantId, values.jobId],
    )
    const job = locked.rows[0]
    if (!job) throw notFound('job')
    assertCompanyAccess(principal, job.company_id!)
    assertVersion(numberValue(job.version), values.expectedJobVersion)
    if (job.state === 'ambiguous') {
      throw new WintourSyncError(
        'WINTOUR_AMBIGUOUS_RETRY_FORBIDDEN',
        'Resultado ambiguo deve ser reconciliado; reenvio pode duplicar a venda.',
        409,
      )
    }
    if (job.state !== 'failed' || !job.payload_bytes) {
      throw new WintourSyncError(
        'WINTOUR_RETRY_NOT_ALLOWED',
        'Somente falha conhecida com artefato preservado pode ser reenviada.',
        409,
      )
    }
    if (numberValue(job.attempt_count) >= 20) {
      throw new WintourSyncError('WINTOUR_RETRY_LIMIT', 'Limite absoluto de tentativas atingido.', 409)
    }
    const updated = await client.query<JobRow>(
      `update wintour_sync_jobs
       set state = 'ready', max_attempts = greatest(max_attempts, attempt_count + 1),
           last_error_code = null, last_error_message = null,
           updated_by = $3, version = version + 1
       where tenant_id = $1 and id = $2 and version = $4 and state = 'failed'
       returning id, sale_link_id, operation, state, attempt_count, max_attempts,
                 last_error_code, version, prepared_at, updated_at, payload_bytes`,
      [principal.tenantId, job.id, principal.user.id, values.expectedJobVersion],
    )
    if (!updated.rows[0]) throw versionConflict(values.expectedJobVersion, null)
    const linkUpdated = await client.query(
      `update wintour_sale_links
       set state = 'ready', updated_by = $3, version = version + 1
       where tenant_id = $1 and id = $2 and version = $4 and state = 'failed'
       returning id`,
      [principal.tenantId, job.sale_link_id, principal.user.id, numberValue(job.link_version)],
    )
    if (!linkUpdated.rows[0]) throw new WintourSyncError('WINTOUR_SYNC_SOURCE_CHANGED', 'A venda mudou.', 409)
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.job.retry',
      entityType: 'wintour_sync_job',
      entityId: job.id,
      metadata: { reason: values.reason },
    })
    return mapJob(updated.rows[0])
  })
}

export async function reconcileWintourSyncJob(
  principal: RequestPrincipal,
  input: ReconcileWintourSyncJobInput,
): Promise<WintourSyncJobSummary> {
  requireWintourPermission(principal)
  const values = reconcileWintourSyncJobInputSchema.parse(input)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const locked = await client.query<JobRow & {
      link_version: number | string
      link_state: WintourSyncState
      wintour_sale_number: number | string | null
      current_link_source_fingerprint: string
    }>(
      `select job.id, job.sale_link_id, job.company_id, job.operation, job.state,
              job.attempt_count, job.max_attempts, job.last_error_code,
              job.version, job.prepared_at, job.updated_at,
              link.version as link_version, link.state as link_state,
              link.wintour_sale_number, job.link_source_fingerprint,
              link.source_fingerprint as current_link_source_fingerprint
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       where job.tenant_id = $1 and job.id = $2
       for update of job, link`,
      [principal.tenantId, values.jobId],
    )
    const job = locked.rows[0]
    if (!job) throw notFound('job')
    assertCompanyAccess(principal, job.company_id!)
    assertVersion(numberValue(job.version), values.expectedJobVersion)
    if (!['ambiguous', 'manual_review', 'received', 'processing'].includes(job.state)) {
      throw new WintourSyncError('WINTOUR_RECONCILE_NOT_ALLOWED', 'O job nao aguarda reconciliacao.', 409)
    }
    const effectiveSaleNumber = job.wintour_sale_number === null
      ? values.wintourSaleNumber || null
      : String(job.wintour_sale_number)
    if (job.wintour_sale_number !== null && values.wintourSaleNumber
        && String(job.wintour_sale_number) !== values.wintourSaleNumber) {
      throw new WintourSyncError('WINTOUR_SALE_NUMBER_IMMUTABLE', 'Numero Wintour imutavel.', 409)
    }
    if (values.targetState === 'completed' && job.operation === 'create' && !effectiveSaleNumber) {
      throw new WintourSyncError(
        'WINTOUR_COMPLETION_SALE_NUMBER_REQUIRED',
        'Conclusao da criacao exige numero da venda Wintour.',
        409,
      )
    }
    const updated = await client.query<JobRow>(
      `update wintour_sync_jobs
       set state = $4, lease_token = null, lease_expires_at = null,
           poll_lease_token = null, poll_lease_expires_at = null,
           completed_at = case when $4 = 'completed' then now() else completed_at end,
           updated_by = $5, version = version + 1
       where tenant_id = $1 and id = $2 and version = $3
       returning id, sale_link_id, operation, state, attempt_count, max_attempts,
                 last_error_code, version, prepared_at, updated_at, payload_bytes`,
      [principal.tenantId, job.id, values.expectedJobVersion, values.targetState, principal.user.id],
    )
    if (!updated.rows[0]) throw versionConflict(values.expectedJobVersion, null)
    await client.query(
      `update wintour_sale_links
       set state = case when source_fingerprint = $7 then $3 else state end,
           wintour_sale_number = coalesce(wintour_sale_number, $4::bigint),
           updated_by = $5, version = version + 1
       where tenant_id = $1 and id = $2 and version = $6
         and (
           source_fingerprint = $7
           or ($4::bigint is not null and wintour_sale_number is null)
         )
       returning id`,
      [
        principal.tenantId,
        job.sale_link_id,
        values.targetState,
        effectiveSaleNumber,
        principal.user.id,
        numberValue(job.link_version),
        job.link_source_fingerprint,
      ],
    )
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.job.reconcile',
      entityType: 'wintour_sync_job',
      entityId: job.id,
      metadata: {
        fromState: job.state,
        targetState: values.targetState,
        wintourSaleNumber: effectiveSaleNumber,
        reason: values.reason,
      },
    })
    return mapJob(updated.rows[0])
  })
}

export async function claimWintourSyncJobs(
  principal: RequestPrincipal,
  input: ClaimWintourSyncJobsInput = {},
): Promise<ClaimedWintourSyncJob[]> {
  requireWorkerPermission(principal)
  const values = claimWintourSyncJobsInputSchema.parse(input)

  return withTenantTransaction(principal.tenantId, async (client) => {
    await lockCanonicalEmissionTables(client)
    const settings = await requireEnabledSettings(client, principal.tenantId)
    if (!settings.auto_send) return []
    await client.query(
      `with stale as (
         update wintour_sync_jobs job
         set state = 'manual_review',
             blocked_reasons = '["source_changed_or_ineligible_after_prepare"]'::jsonb,
             last_error_code = 'WINTOUR_SOURCE_CHANGED_AFTER_PREPARE',
             last_error_message = 'A fonte mudou ou deixou de ser elegivel depois da preparacao do XML.',
             updated_by = $2, version = version + 1
         from wintour_sale_links link
         where job.tenant_id = $1 and link.tenant_id = job.tenant_id
           and link.id = job.sale_link_id and job.state = 'ready'
           and (
             job.link_source_fingerprint <> link.source_fingerprint
             or coalesce(wintour_sale_source_freshness_at(
               job.tenant_id, job.emission_id, link.source_ticket_id, job.company_id
             ), 'infinity'::timestamptz) > link.source_refreshed_at
             or (
               job.operation = 'create'
               and (
                 not exists (
                   select 1 from travel_emissions emission
                   where emission.tenant_id = job.tenant_id
                     and emission.id = job.emission_id
                     and emission.status = 'issued'
                     and emission.provider = 'manual-offline'
                 )
                 or (
                   link.source_ticket_id is not null
                   and not exists (
                     select 1 from air_emission_tickets ticket
                     where ticket.tenant_id = link.tenant_id
                       and ticket.id = link.source_ticket_id
                       and ticket.emission_id = link.emission_id
                       and ticket.status = 'issued'
                   )
                 )
                 or exists (
                   select 1 from air_emission_tickets sibling
                   where sibling.tenant_id = job.tenant_id
                     and sibling.emission_id = job.emission_id
                     and sibling.status <> 'issued'
                 )
                 or exists (
                   select 1
                   from travel_emissions emission
                   join air_reservation_segments segment
                     on segment.tenant_id = emission.tenant_id
                    and segment.reservation_id = emission.reservation_id
                   where emission.tenant_id = job.tenant_id
                     and emission.id = job.emission_id
                     and segment.status <> 'issued'
                 )
                 or not exists (
                   select 1
                   from travel_emissions emission
                   join air_reservation_segments segment
                     on segment.tenant_id = emission.tenant_id
                    and segment.reservation_id = emission.reservation_id
                   where emission.tenant_id = job.tenant_id
                     and emission.id = job.emission_id
                 )
                 or not exists (
                   select 1
                   from travel_emissions emission
                   join air_demand_details detail
                     on detail.tenant_id = emission.tenant_id
                    and detail.demand_id = emission.demand_id
                   where emission.tenant_id = job.tenant_id
                     and emission.id = job.emission_id
                 )
               )
             )
           )
         returning job.sale_link_id
       )
       update wintour_sale_links link
       set state = 'manual_review',
           blocked_reasons = '["source_changed_or_ineligible_after_prepare"]'::jsonb,
           updated_by = $2, version = version + 1
       where link.tenant_id = $1 and link.state = 'ready'
         and link.id in (select sale_link_id from stale)`,
      [principal.tenantId, principal.user.id],
    )
    const candidates = await client.query<JobRow & {
      idv_externo: number | string
      wintour_sale_number: number | string | null
      link_version: number | string
      link_source_snapshot: unknown
      source_ticket_id: string | null
      current_link_source_fingerprint: string
    }>(
      `select job.id, job.sale_link_id, job.company_id, job.emission_id,
              job.operation, job.source_fingerprint, job.source_snapshot,
              job.state, job.attempt_count, job.max_attempts, job.last_error_code,
              job.version, job.prepared_at, job.updated_at,
              job.payload_bytes, job.payload_sha256, job.payload_filename,
              job.payload_content_type, job.serializer_version,
              job.transport_free_field, job.link_source_fingerprint, job.config_fingerprint,
              link.idv_externo, link.wintour_sale_number, link.version as link_version,
              link.source_snapshot as link_source_snapshot,
              link.source_ticket_id,
              link.source_fingerprint as current_link_source_fingerprint
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       where job.tenant_id = $1
         and (
           job.state = 'ready'
         )
         and job.attempt_count < job.max_attempts
         and link.state = 'ready'
         and job.link_source_fingerprint = link.source_fingerprint
         and coalesce(wintour_sale_source_freshness_at(
           job.tenant_id, job.emission_id, link.source_ticket_id, job.company_id
         ), 'infinity'::timestamptz) <= link.source_refreshed_at
          and (
            job.operation = 'update'
            or (
          exists (
           select 1 from travel_emissions emission
           where emission.tenant_id = job.tenant_id and emission.id = job.emission_id
              and emission.status = 'issued'
             and emission.provider = 'manual-offline'
         )
         and (
           link.source_ticket_id is null
           or exists (
             select 1 from air_emission_tickets ticket
             where ticket.tenant_id = link.tenant_id
               and ticket.id = link.source_ticket_id
               and ticket.emission_id = link.emission_id
               and ticket.status = 'issued'
           )
         )
         and not exists (
           select 1 from air_emission_tickets sibling
           where sibling.tenant_id = job.tenant_id
             and sibling.emission_id = job.emission_id
             and sibling.status <> 'issued'
         )
         and not exists (
           select 1
           from travel_emissions emission
           join air_reservation_segments segment
             on segment.tenant_id = emission.tenant_id
            and segment.reservation_id = emission.reservation_id
           where emission.tenant_id = job.tenant_id
             and emission.id = job.emission_id
             and segment.status <> 'issued'
         )
         and exists (
           select 1
           from travel_emissions emission
           join air_reservation_segments segment
             on segment.tenant_id = emission.tenant_id
            and segment.reservation_id = emission.reservation_id
           where emission.tenant_id = job.tenant_id
             and emission.id = job.emission_id
         )
         and exists (
           select 1
           from travel_emissions emission
           join air_demand_details detail
             on detail.tenant_id = emission.tenant_id
            and detail.demand_id = emission.demand_id
           where emission.tenant_id = job.tenant_id
             and emission.id = job.emission_id
          )
            )
          )
          and job.payload_bytes is not null
       order by job.prepared_at, job.id
       for update of job, link skip locked
       limit $2`,
      [principal.tenantId, Math.min(values.limit, 1)],
    )
    const claimed: ClaimedWintourSyncJob[] = []

    for (const candidate of candidates.rows) {
      const liveSource = await loadCanonicalEmissionCandidate(client, {
        tenantId: principal.tenantId,
        companyId: candidate.company_id!,
        emissionId: candidate.emission_id!,
        sourceTicketId: candidate.source_ticket_id,
      })
      const liveCanonical = liveSource && candidate.operation === 'create'
        ? buildCanonicalSale(liveSource, settings)
        : null
      const liveBlockers = !liveSource
        ? ['source_changed_or_ineligible_after_prepare']
        : candidate.operation === 'create' && liveCanonical
          ? discoveryBlockers(liveSource, settings, liveCanonical.blockers)
          : []
      const liveSourceFingerprint = liveSource
        ? fingerprint(emissionSourceFingerprint(liveSource))
        : null
      if (!liveSourceFingerprint
          || liveBlockers.length > 0
          || liveSourceFingerprint !== candidate.current_link_source_fingerprint
          || liveSourceFingerprint !== candidate.link_source_fingerprint) {
        const staleJob = await client.query(
          `update wintour_sync_jobs
           set state = 'manual_review',
               blocked_reasons = '["source_changed_or_ineligible_after_prepare"]'::jsonb,
               last_error_code = 'WINTOUR_SOURCE_CHANGED_AFTER_PREPARE',
               last_error_message = 'A fonte canonica divergiu depois da preparacao do XML.',
               updated_by = $3, version = version + 1
           where tenant_id = $1 and id = $2 and version = $4 and state = 'ready'
           returning id`,
          [
            principal.tenantId, candidate.id, principal.user.id,
            numberValue(candidate.version),
          ],
        )
        if (staleJob.rows[0]) {
          await client.query(
            `update wintour_sale_links
             set state = 'manual_review',
                 blocked_reasons = '["source_changed_or_ineligible_after_prepare"]'::jsonb,
                 updated_by = $3, version = version + 1
             where tenant_id = $1 and id = $2 and version = $4 and state = 'ready'`,
            [
              principal.tenantId, candidate.sale_link_id, principal.user.id,
              numberValue(candidate.link_version),
            ],
          )
        }
        continue
      }
      const linkSnapshot = objectValue(candidate.link_source_snapshot)
      let currentMappings = objectValue(linkSnapshot.mappings)
      if (candidate.operation === 'create') {
        currentMappings = await loadCurrentSaleMappings(client, principal.tenantId, candidate, false)
      }
      const currentConfigFingerprint = fingerprint(preparationConfiguration(
        settings,
        candidate.operation,
        { ...linkSnapshot, mappings: currentMappings },
      ))
      if (candidate.config_fingerprint !== currentConfigFingerprint) {
        const staleJob = await client.query(
          `update wintour_sync_jobs
           set state = 'manual_review',
               blocked_reasons = '["configuration_changed_after_prepare"]'::jsonb,
               last_error_code = 'WINTOUR_CONFIGURATION_CHANGED_AFTER_PREPARE',
               last_error_message = 'A parametrizacao mudou depois da preparacao do XML.',
               updated_by = $3, version = version + 1
           where tenant_id = $1 and id = $2 and version = $4 and state = 'ready'
           returning id`,
          [
            principal.tenantId, candidate.id, principal.user.id,
            numberValue(candidate.version),
          ],
        )
        if (staleJob.rows[0]) {
          await client.query(
            `update wintour_sale_links
             set state = 'manual_review',
                 blocked_reasons = '["configuration_changed_after_prepare"]'::jsonb,
                 updated_by = $3, version = version + 1
             where tenant_id = $1 and id = $2 and version = $4 and state = 'ready'`,
            [
              principal.tenantId, candidate.sale_link_id, principal.user.id,
              numberValue(candidate.link_version),
            ],
          )
        }
        continue
      }
      const leaseToken = randomUUID()
      const attemptNumber = numberValue(candidate.attempt_count) + 1
      const updatedJob = await client.query<JobRow & { lease_expires_at: Date | string }>(
        `update wintour_sync_jobs
         set state = 'sending', attempt_count = attempt_count + 1,
             lease_token = $3, lease_expires_at = now() + ($4::text || ' seconds')::interval,
             last_error_code = null, last_error_message = null,
             updated_by = $5, version = version + 1
         where tenant_id = $1 and id = $2 and version = $6
         returning id, sale_link_id, company_id, emission_id, operation,
                   source_fingerprint, source_snapshot, state, attempt_count,
                   max_attempts, last_error_code, version, prepared_at, updated_at,
                   lease_expires_at`,
        [
          principal.tenantId,
          candidate.id,
          leaseToken,
          values.leaseSeconds,
          principal.user.id,
          numberValue(candidate.version),
        ],
      )
      const job = updatedJob.rows[0]
      if (!job) continue
      const attempt = await client.query<{ id: string; version: number | string }>(
        `insert into wintour_sync_attempts (
           tenant_id, sale_link_id, job_id, attempt_number, lease_token,
           state, request_fingerprint, created_by
         ) values ($1, $2, $3, $4, $5, 'sending', $6, $7)
         returning id, version`,
        [
          principal.tenantId,
          job.sale_link_id,
          job.id,
          attemptNumber,
          leaseToken,
          fingerprint({
            payloadSha256: candidate.payload_sha256,
            transportFreeField: candidate.transport_free_field || null,
            operation: candidate.operation,
            serializerVersion: candidate.serializer_version,
          }),
          principal.user.id,
        ],
      )
      const linkUpdate = await client.query(
        `update wintour_sale_links
         set state = 'sending', updated_by = $3, version = version + 1
         where tenant_id = $1 and id = $2 and version = $4 and state = 'ready'
         returning id`,
        [
          principal.tenantId,
          job.sale_link_id,
          principal.user.id,
          numberValue(candidate.link_version),
        ],
      )
      if (!linkUpdate.rows[0]) {
        throw new WintourSyncError(
          'WINTOUR_SYNC_SOURCE_CHANGED',
          'A venda mudou antes do claim; o job nao pode ser enviado.',
          409,
        )
      }
      claimed.push({
        id: job.id,
        saleLinkId: job.sale_link_id,
        companyId: job.company_id!,
        emissionId: job.emission_id!,
        operation: job.operation,
        idvExterno: String(candidate.idv_externo),
        wintourSaleNumber: candidate.wintour_sale_number === null
          ? null
          : String(candidate.wintour_sale_number),
        payloadBytes: Uint8Array.from(job.payload_bytes || []),
        payloadSha256: job.payload_sha256!,
        payloadFilename: job.payload_filename!,
        payloadContentType: 'application/xml',
        serializerVersion: job.serializer_version!,
        freeField: candidate.transport_free_field || null,
        attemptId: attempt.rows[0].id,
        attemptNumber,
        leaseToken,
        leaseExpiresAt: iso(updatedJob.rows[0].lease_expires_at),
        jobVersion: numberValue(job.version),
        attemptVersion: numberValue(attempt.rows[0].version),
      })
    }

    if (claimed.length) {
      await auditInTransaction(client, principal, {
        action: 'integration.wintour_sync.jobs.claim',
        entityType: 'wintour_sync_job',
        entityId: null,
        metadata: { count: claimed.length, jobIds: claimed.map((job) => job.id) },
      })
    }
    return claimed
  })
}

export async function recordWintourSyncAttemptResult(
  principal: RequestPrincipal,
  input: RecordWintourSyncAttemptResultInput,
): Promise<WintourSyncJobSummary> {
  requireWorkerPermission(principal)
  const values = recordWintourSyncAttemptResultInputSchema.parse(input)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const locked = await client.query<{
      job_version: number | string
      job_state: WintourSyncState
      job_lease_token: string | null
      lease_expires_at: Date | string | null
      sale_link_id: string
      link_state: WintourSyncState
      link_version: number | string
      attempt_version: number | string
      attempt_lease_token: string
      operation: 'create' | 'update'
      wintour_sale_number: number | string | null
      link_source_fingerprint: string
      current_link_source_fingerprint: string
    }>(
      `select job.version as job_version, job.state as job_state,
              job.lease_token as job_lease_token, job.lease_expires_at,
              job.sale_link_id, link.state as link_state, link.version as link_version,
              attempt.version as attempt_version,
              attempt.lease_token as attempt_lease_token,
              job.operation, link.wintour_sale_number,
              job.link_source_fingerprint,
              link.source_fingerprint as current_link_source_fingerprint
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       join wintour_sync_attempts attempt
         on attempt.tenant_id = job.tenant_id and attempt.job_id = job.id
       where job.tenant_id = $1 and job.id = $2 and attempt.id = $3
       for update of job, link, attempt`,
      [principal.tenantId, values.jobId, values.attemptId],
    )
    const row = locked.rows[0]
    if (!row) throw notFound('job/tentativa')
    if (numberValue(row.job_version) !== values.expectedJobVersion
        || numberValue(row.attempt_version) !== values.expectedAttemptVersion) {
      throw versionConflict(values.expectedJobVersion, numberValue(row.job_version))
    }
    if (row.job_state !== 'sending'
        || row.job_lease_token !== values.leaseToken
        || row.attempt_lease_token !== values.leaseToken
        || !row.lease_expires_at) {
      throw new WintourSyncError(
        'WINTOUR_SYNC_LEASE_LOST',
        'Lease do job Wintour expirou ou pertence a outro worker.',
        409,
      )
    }
    const attemptUpdate = await client.query(
      `update wintour_sync_attempts
       set state = $4, response_fingerprint = $5, error_code = $6,
           error_message = $7, finished_at = now(), version = version + 1
       where tenant_id = $1 and id = $2 and version = $3 and lease_token = $8
       returning id`,
      [
        principal.tenantId,
        values.attemptId,
        values.expectedAttemptVersion,
        values.state,
        values.responseFingerprint || null,
        values.errorCode || null,
        values.errorMessage || null,
        values.leaseToken,
      ],
    )
    if (!attemptUpdate.rows[0]) throw versionConflict(values.expectedAttemptVersion, null)
    const jobUpdate = await client.query<JobRow>(
      `update wintour_sync_jobs
       set state = $4, lease_token = null, lease_expires_at = null,
           last_error_code = $5, last_error_message = $6,
           completed_at = case when $4 = 'completed' then now() else completed_at end,
           updated_by = $7, version = version + 1
       where tenant_id = $1 and id = $2 and version = $3 and lease_token = $8
       returning id, sale_link_id, operation, state, attempt_count, max_attempts,
                 last_error_code, version, prepared_at, updated_at`,
      [
        principal.tenantId,
        values.jobId,
        values.expectedJobVersion,
        values.state,
        values.errorCode || null,
        values.errorMessage || null,
        principal.user.id,
        values.leaseToken,
      ],
    )
    if (!jobUpdate.rows[0]) throw versionConflict(values.expectedJobVersion, null)
    await client.query(
      `update wintour_sale_links
       set state = $3, updated_by = $4, version = version + 1
       where tenant_id = $1 and id = $2 and version = $5 and state = 'sending'
         and source_fingerprint = $6
       returning id`,
      [
        principal.tenantId, row.sale_link_id, values.state, principal.user.id,
        numberValue(row.link_version), row.link_source_fingerprint,
      ],
    )
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.attempt.result',
      entityType: 'wintour_sync_attempt',
      entityId: values.attemptId,
      metadata: { jobId: values.jobId, state: values.state, errorCode: values.errorCode || null },
    })
    return mapJob(jobUpdate.rows[0])
  })
}

export async function recordWintourSubmissionSuccess(
  principal: RequestPrincipal,
  input: RecordWintourSubmissionSuccessInput,
): Promise<WintourSyncJobSummary> {
  requireWorkerPermission(principal)
  const values = recordWintourSubmissionSuccessInputSchema.parse(input)
  const redactedPayload = validateRedactedPayload(values.redactedPayload)
  const observationKey = fingerprint({
    jobId: values.jobId,
    attemptId: values.attemptId,
    protocolKind: 'submission',
    protocolCode: values.protocolCode,
    state: 'received',
    responseFingerprint: values.responseFingerprint || null,
  })

  return withTenantTransaction(principal.tenantId, async (client) => {
    const locked = await client.query<JobRow & {
      job_lease_token: string | null
      link_state: WintourSyncState
      link_version: number | string
      attempt_state: WintourSyncState
      attempt_version: number | string
      attempt_lease_token: string
      link_source_fingerprint: string
      current_link_source_fingerprint: string
    }>(
      `select job.id, job.sale_link_id, job.operation, job.state,
              job.attempt_count, job.max_attempts, job.last_error_code,
              job.version, job.prepared_at, job.updated_at,
              job.lease_token as job_lease_token,
              link.state as link_state, link.version as link_version,
              attempt.state as attempt_state, attempt.version as attempt_version,
              attempt.lease_token as attempt_lease_token,
              job.link_source_fingerprint,
              link.source_fingerprint as current_link_source_fingerprint
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       join wintour_sync_attempts attempt
         on attempt.tenant_id = job.tenant_id and attempt.job_id = job.id
        and attempt.id = $3
       where job.tenant_id = $1 and job.id = $2
       for update of job, link, attempt`,
      [principal.tenantId, values.jobId, values.attemptId],
    )
    const job = locked.rows[0]
    if (!job) throw notFound('job/tentativa')
    const existingProtocol = await client.query<{ id: string }>(
      `select id from wintour_sync_protocols
       where tenant_id = $1 and observation_key = $2`,
      [principal.tenantId, observationKey],
    )
    if (existingProtocol.rows[0]
        && job.state === 'received'
        && job.attempt_state === 'received') {
      return mapJob(job)
    }
    assertVersion(numberValue(job.version), values.expectedJobVersion)
    assertVersion(numberValue(job.attempt_version), values.expectedAttemptVersion)
    if (job.state !== 'sending'
        || job.attempt_state !== 'sending'
        || job.job_lease_token !== values.leaseToken
        || job.attempt_lease_token !== values.leaseToken) {
      throw new WintourSyncError(
        'WINTOUR_SYNC_LEASE_LOST',
        'Lease do envio Wintour expirou ou pertence a outro worker.',
        409,
      )
    }

    const attemptUpdate = await client.query(
      `update wintour_sync_attempts
       set state = 'received', response_fingerprint = $4,
           error_code = null, error_message = null,
           finished_at = now(), version = version + 1
       where tenant_id = $1 and id = $2 and version = $3 and lease_token = $5
       returning id`,
      [
        principal.tenantId, values.attemptId, values.expectedAttemptVersion,
        values.responseFingerprint || null, values.leaseToken,
      ],
    )
    if (!attemptUpdate.rows[0]) throw versionConflict(values.expectedAttemptVersion, null)
    const protocol = await client.query<{ id: string }>(
      `insert into wintour_sync_protocols (
         tenant_id, sale_link_id, job_id, attempt_id, protocol_kind,
         protocol_code, observation_key, state, response_fingerprint,
         redacted_payload, created_by
       ) values ($1, $2, $3, $4, 'submission', $5, $6, 'received', $7, $8::jsonb, $9)
       on conflict (tenant_id, observation_key) do nothing
       returning id`,
      [
        principal.tenantId, job.sale_link_id, job.id, values.attemptId,
        values.protocolCode, observationKey, values.responseFingerprint || null,
        JSON.stringify(redactedPayload), principal.user.id,
      ],
    )
    if (!protocol.rows[0] && !existingProtocol.rows[0]) {
      throw new WintourSyncError(
        'WINTOUR_SUBMISSION_PROTOCOL_CONFLICT',
        'Nao foi possivel persistir o protocolo do envio de forma idempotente.',
        409,
      )
    }
    const jobUpdate = await client.query<JobRow>(
      `update wintour_sync_jobs
       set state = 'received', lease_token = null, lease_expires_at = null,
           next_poll_at = now(), last_error_code = null, last_error_message = null,
           updated_by = $4, version = version + 1
       where tenant_id = $1 and id = $2 and version = $3 and lease_token = $5
       returning id, sale_link_id, operation, state, attempt_count, max_attempts,
                 last_error_code, version, prepared_at, updated_at, payload_bytes`,
      [
        principal.tenantId, job.id, values.expectedJobVersion,
        principal.user.id, values.leaseToken,
      ],
    )
    if (!jobUpdate.rows[0]) throw versionConflict(values.expectedJobVersion, null)
    await client.query(
      `update wintour_sale_links
       set state = 'received', updated_by = $3, version = version + 1
       where tenant_id = $1 and id = $2 and version = $4 and state = 'sending'
         and source_fingerprint = $5
       returning id`,
      [
        principal.tenantId, job.sale_link_id, principal.user.id,
        numberValue(job.link_version), job.link_source_fingerprint,
      ],
    )
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.submission.received',
      entityType: 'wintour_sync_protocol',
      entityId: protocol.rows[0]?.id || existingProtocol.rows[0]?.id || null,
      metadata: {
        jobId: job.id,
        attemptId: values.attemptId,
        protocolCode: values.protocolCode,
      },
    })
    return mapJob(jobUpdate.rows[0])
  })
}

export async function claimWintourPollJobs(
  principal: RequestPrincipal,
  input: ClaimWintourPollJobsInput = {},
): Promise<ClaimedWintourPollJob[]> {
  requireWorkerPermission(principal)
  const values = claimWintourPollJobsInputSchema.parse(input)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const settings = await requireEnabledSettings(client, principal.tenantId)
    if (!settings.auto_poll) return []
    await client.query(
      `update wintour_sync_jobs job
       set state = 'manual_review',
           blocked_reasons = '["source_changed_or_ineligible_after_prepare"]'::jsonb,
           last_error_code = 'WINTOUR_SOURCE_CHANGED_AFTER_SUBMISSION',
           last_error_message = 'A fonte mudou depois do envio; reconciliacao manual obrigatoria.',
           poll_lease_token = null, poll_lease_expires_at = null,
           updated_by = $2, version = version + 1
       from wintour_sale_links link
       where job.tenant_id = $1 and link.tenant_id = job.tenant_id
         and link.id = job.sale_link_id and job.state in ('received', 'processing')
         and (job.poll_lease_token is null or job.poll_lease_expires_at <= now())
         and (
           job.link_source_fingerprint <> link.source_fingerprint
           or link.state not in ('received', 'processing')
           or jsonb_array_length(link.blocked_reasons) > 0
         )`,
      [principal.tenantId, principal.user.id],
    )
    await client.query(
      `update wintour_sync_jobs job
       set state = 'manual_review',
           blocked_reasons = '["poll_limit_exhausted"]'::jsonb,
           last_error_code = 'WINTOUR_POLL_LIMIT_EXHAUSTED',
           last_error_message = 'Limite seguro de consultas do protocolo atingido.',
           poll_lease_token = null, poll_lease_expires_at = null,
           next_poll_at = null, updated_by = $2, version = version + 1
       where job.tenant_id = $1 and job.state in ('received', 'processing')
         and (job.poll_lease_token is null or job.poll_lease_expires_at <= now())
         and (
           job.poll_attempt_count >= $3
           or job.poll_started_at <= now() - ($4::text || ' hours')::interval
         )`,
      [
        principal.tenantId,
        principal.user.id,
        WINTOUR_MAX_POLL_ATTEMPTS,
        WINTOUR_MAX_POLL_WINDOW_HOURS,
      ],
    )
    const candidates = await client.query<{
      id: string
      sale_link_id: string
      operation: 'create' | 'update'
      state: 'received' | 'processing'
      version: number | string
      link_version: number | string
      attempt_id: string
      protocol_code: string
    }>(
      `select job.id, job.sale_link_id, job.operation, job.state, job.version,
              link.version as link_version, protocol.attempt_id, protocol.protocol_code
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       join lateral (
         select attempt_id, protocol_code
         from wintour_sync_protocols candidate
         where candidate.tenant_id = job.tenant_id and candidate.job_id = job.id
         order by candidate.observed_at desc, candidate.id desc limit 1
       ) protocol on true
       where job.tenant_id = $1 and job.state in ('received', 'processing')
         and job.link_source_fingerprint = link.source_fingerprint
         and link.state in ('received', 'processing')
         and jsonb_array_length(link.blocked_reasons) = 0
         and job.poll_attempt_count < $3
         and (
           job.poll_started_at is null
           or job.poll_started_at > now() - ($4::text || ' hours')::interval
         )
         and (job.next_poll_at is null or job.next_poll_at <= now())
         and (job.poll_lease_token is null or job.poll_lease_expires_at <= now())
       order by job.next_poll_at nulls first, job.prepared_at, job.id
       for update of job, link skip locked
       limit $2`,
      [
        principal.tenantId,
        values.limit,
        WINTOUR_MAX_POLL_ATTEMPTS,
        WINTOUR_MAX_POLL_WINDOW_HOURS,
      ],
    )
    const claimed: ClaimedWintourPollJob[] = []
    for (const candidate of candidates.rows) {
      const pollLeaseToken = randomUUID()
      const updated = await client.query<{ version: number | string; poll_lease_expires_at: Date | string }>(
         `update wintour_sync_jobs
          set state = 'processing', poll_lease_token = $3,
              poll_lease_expires_at = now() + ($4::text || ' seconds')::interval,
              poll_attempt_count = poll_attempt_count + 1,
              poll_started_at = coalesce(poll_started_at, now()),
              updated_by = $5, version = version + 1
         where tenant_id = $1 and id = $2 and version = $6
           and state in ('received', 'processing')
         returning version, poll_lease_expires_at`,
        [
          principal.tenantId, candidate.id, pollLeaseToken, values.leaseSeconds,
          principal.user.id, numberValue(candidate.version),
        ],
      )
      if (!updated.rows[0]) continue
      const link = await client.query(
        `update wintour_sale_links
         set state = 'processing', updated_by = $3, version = version + 1
         where tenant_id = $1 and id = $2 and version = $4
           and state in ('received', 'processing')
         returning id`,
        [
          principal.tenantId, candidate.sale_link_id, principal.user.id,
          numberValue(candidate.link_version),
        ],
      )
      if (!link.rows[0]) throw new WintourSyncError('WINTOUR_SYNC_SOURCE_CHANGED', 'A venda mudou.', 409)
      claimed.push({
        id: candidate.id,
        saleLinkId: candidate.sale_link_id,
        operation: candidate.operation,
        attemptId: candidate.attempt_id,
        protocolCode: candidate.protocol_code,
        pollLeaseToken,
        pollLeaseExpiresAt: iso(updated.rows[0].poll_lease_expires_at),
        jobVersion: numberValue(updated.rows[0].version),
      })
    }
    return claimed
  })
}

export async function recordWintourPollResult(
  principal: RequestPrincipal,
  input: RecordWintourPollResultInput,
): Promise<WintourSyncJobSummary> {
  requireWorkerPermission(principal)
  const values = recordWintourPollResultInputSchema.parse(input)
  const redactedPayload = validateRedactedPayload(values.redactedPayload)
  const observationKey = fingerprint({
    jobId: values.jobId,
    attemptId: values.attemptId,
    protocolKind: 'poll',
    protocolCode: values.protocolCode,
    state: values.state,
    responseFingerprint: values.responseFingerprint || null,
  })
  return withTenantTransaction(principal.tenantId, async (client) => {
    const locked = await client.query<JobRow & {
      link_version: number | string
      link_state: WintourSyncState
      wintour_sale_number: number | string | null
      poll_lease_token: string | null
      attempt_id: string
      current_link_source_fingerprint: string
    }>(
      `select job.id, job.sale_link_id, job.company_id, job.operation, job.state,
              job.attempt_count, job.max_attempts, job.last_error_code,
              job.version, job.prepared_at, job.updated_at, job.poll_lease_token,
              link.version as link_version, link.state as link_state,
              link.wintour_sale_number, attempt.id as attempt_id,
              job.link_source_fingerprint,
              link.source_fingerprint as current_link_source_fingerprint
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       join wintour_sync_attempts attempt
         on attempt.tenant_id = job.tenant_id and attempt.id = $3 and attempt.job_id = job.id
       where job.tenant_id = $1 and job.id = $2
       for update of job, link, attempt`,
      [principal.tenantId, values.jobId, values.attemptId],
    )
    const job = locked.rows[0]
    if (!job) throw notFound('job/tentativa')
    assertVersion(numberValue(job.version), values.expectedJobVersion)
    if (job.poll_lease_token !== values.pollLeaseToken
        || !['received', 'processing'].includes(job.state)) {
      throw new WintourSyncError('WINTOUR_POLL_LEASE_LOST', 'Lease de consulta Wintour perdido.', 409)
    }
    const effectiveSaleNumber = job.wintour_sale_number === null
      ? values.wintourSaleNumber || null
      : String(job.wintour_sale_number)
    if (job.wintour_sale_number !== null && values.wintourSaleNumber
        && String(job.wintour_sale_number) !== values.wintourSaleNumber) {
      throw new WintourSyncError('WINTOUR_SALE_NUMBER_IMMUTABLE', 'Numero Wintour imutavel.', 409)
    }
    if (values.state === 'completed' && job.operation === 'create' && !effectiveSaleNumber) {
      throw new WintourSyncError(
        'WINTOUR_COMPLETION_SALE_NUMBER_REQUIRED',
        'Conclusao da criacao exige numero da venda Wintour.',
        409,
      )
    }
    await client.query(
      `insert into wintour_sync_protocols (
         tenant_id, sale_link_id, job_id, attempt_id, protocol_kind,
         protocol_code, observation_key, state, response_fingerprint,
         redacted_payload, created_by
       ) values ($1, $2, $3, $4, 'poll', $5, $6, $7, $8, $9::jsonb, $10)
       on conflict (tenant_id, observation_key) do nothing`,
      [
        principal.tenantId, job.sale_link_id, job.id, values.attemptId,
        values.protocolCode, observationKey, values.state,
        values.responseFingerprint || null, JSON.stringify(redactedPayload), principal.user.id,
      ],
    )
    const continuePolling = values.state === 'received' || values.state === 'processing'
    const updated = await client.query<JobRow>(
      `update wintour_sync_jobs
       set state = $4, poll_lease_token = null, poll_lease_expires_at = null,
           next_poll_at = case when $5 then now() + ($6::text || ' seconds')::interval else null end,
           completed_at = case when $4 = 'completed' then now() else completed_at end,
           updated_by = $7, version = version + 1
       where tenant_id = $1 and id = $2 and version = $3 and poll_lease_token = $8
       returning id, sale_link_id, operation, state, attempt_count, max_attempts,
                 last_error_code, version, prepared_at, updated_at, payload_bytes`,
      [
        principal.tenantId, job.id, values.expectedJobVersion, values.state,
        continuePolling, values.nextPollSeconds, principal.user.id, values.pollLeaseToken,
      ],
    )
    if (!updated.rows[0]) throw versionConflict(values.expectedJobVersion, null)
    await client.query(
      `update wintour_sale_links
       set state = case
             when source_fingerprint = $7 and state in ('received', 'processing') then $3
             else state
           end,
           wintour_sale_number = coalesce(wintour_sale_number, $4::bigint),
           updated_by = $5, version = version + 1
       where tenant_id = $1 and id = $2 and version = $6
         and (
           (source_fingerprint = $7 and state in ('received', 'processing'))
           or ($4::bigint is not null and wintour_sale_number is null)
         )
       returning id`,
      [
        principal.tenantId, job.sale_link_id, values.state, effectiveSaleNumber,
        principal.user.id, numberValue(job.link_version), job.link_source_fingerprint,
      ],
    )
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.poll.result',
      entityType: 'wintour_sync_job',
      entityId: job.id,
      metadata: { state: values.state, protocolCode: values.protocolCode },
    })
    return mapJob(updated.rows[0])
  })
}

export async function recordWintourSyncProtocol(
  principal: RequestPrincipal,
  input: RecordWintourSyncProtocolInput,
): Promise<WintourSyncJobSummary> {
  requireWorkerPermission(principal)
  const values = recordWintourSyncProtocolInputSchema.parse(input)
  const redactedPayload = validateRedactedPayload(values.redactedPayload)
  const observationKey = fingerprint({
    jobId: values.jobId,
    attemptId: values.attemptId,
    protocolKind: values.protocolKind,
    protocolCode: values.protocolCode,
    state: values.state,
    responseFingerprint: values.responseFingerprint || null,
  })

  return withTenantTransaction(principal.tenantId, async (client) => {
    const locked = await client.query<JobRow & {
      link_state: WintourSyncState
      link_version: number | string
      wintour_sale_number: number | string | null
      attempt_id: string
      link_source_fingerprint: string
      current_link_source_fingerprint: string
    }>(
      `select job.id, job.sale_link_id, job.operation, job.state,
              job.attempt_count, job.max_attempts, job.last_error_code,
              job.version, job.prepared_at, job.updated_at,
              link.state as link_state, link.version as link_version,
              link.wintour_sale_number, job.link_source_fingerprint,
              link.source_fingerprint as current_link_source_fingerprint,
              attempt.id as attempt_id
       from wintour_sync_jobs job
       join wintour_sale_links link
         on link.tenant_id = job.tenant_id and link.id = job.sale_link_id
       join wintour_sync_attempts attempt
         on attempt.tenant_id = job.tenant_id and attempt.job_id = job.id
       where job.tenant_id = $1 and job.id = $2 and attempt.id = $3
       for update of job, link, attempt`,
      [principal.tenantId, values.jobId, values.attemptId],
    )
    const job = locked.rows[0]
    if (!job) throw notFound('job/tentativa')

    const existingProtocol = await client.query<{ id: string }>(
      `select id from wintour_sync_protocols
       where tenant_id = $1 and observation_key = $2`,
      [principal.tenantId, observationKey],
    )
    if (existingProtocol.rows[0] && job.state === values.state) return mapJob(job)
    assertVersion(numberValue(job.version), values.expectedJobVersion)
    if (values.state === 'completed' && job.operation === 'create' && job.wintour_sale_number === null) {
      throw new WintourSyncError(
        'WINTOUR_COMPLETION_SALE_NUMBER_REQUIRED',
        'A criacao nao pode concluir sem reconciliar o numero da venda Wintour.',
        409,
      )
    }

    if (!existingProtocol.rows[0]) {
      await client.query(
        `insert into wintour_sync_protocols (
           tenant_id, sale_link_id, job_id, attempt_id, protocol_kind,
           protocol_code, observation_key, state, response_fingerprint,
           redacted_payload, created_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
        [
          principal.tenantId,
          job.sale_link_id,
          job.id,
          values.attemptId,
          values.protocolKind,
          values.protocolCode,
          observationKey,
          values.state,
          values.responseFingerprint || null,
          JSON.stringify(redactedPayload),
          principal.user.id,
        ],
      )
    }
    const updated = await client.query<JobRow>(
      `update wintour_sync_jobs
       set state = $4, completed_at = case when $4 = 'completed' then now() else completed_at end,
           updated_by = $5, version = version + 1
       where tenant_id = $1 and id = $2 and version = $3
       returning id, sale_link_id, operation, state, attempt_count, max_attempts,
                 last_error_code, version, prepared_at, updated_at`,
      [principal.tenantId, job.id, values.expectedJobVersion, values.state, principal.user.id],
    )
    if (!updated.rows[0]) throw versionConflict(values.expectedJobVersion, null)
    await client.query(
      `update wintour_sale_links
       set state = $3, updated_by = $4, version = version + 1
       where tenant_id = $1 and id = $2 and version = $5
         and source_fingerprint = $6 and state = $7
       returning id`,
      [
        principal.tenantId, job.sale_link_id, values.state, principal.user.id,
        numberValue(job.link_version), job.link_source_fingerprint, job.link_state,
      ],
    )
    await auditInTransaction(client, principal, {
      action: 'integration.wintour_sync.protocol.record',
      entityType: 'wintour_sync_protocol',
      entityId: existingProtocol.rows[0]?.id || null,
      metadata: {
        jobId: job.id,
        attemptId: values.attemptId,
        protocolKind: values.protocolKind,
        protocolCode: values.protocolCode,
        state: values.state,
      },
    })
    return mapJob(updated.rows[0])
  })
}

async function requireEnabledSettings(client: PoolClient, tenantId: string): Promise<SettingsRow> {
  const result = await client.query<SettingsRow>(
    `select enabled, sync_from, agency_name, branch_id, branch_name, free_field,
            product_codes, payment_method_codes, service_route_types,
            tariff_net_default, account_defaults, customer_action, auto_send, auto_poll,
            max_attempts, discovery_batch_size, version, updated_at
     from wintour_sync_settings where tenant_id = $1 for update`,
    [tenantId],
  )
  const settings = result.rows[0]
  if (!settings?.enabled) {
    throw new WintourSyncError(
      'WINTOUR_SYNC_DISABLED',
      'A sincronizacao Wintour esta desabilitada para este tenant.',
      409,
    )
  }
  return settings
}

async function lockSaleLink(client: PoolClient, tenantId: string, id: string): Promise<SaleLinkRow> {
  const result = await client.query<SaleLinkRow>(
    `select id, company_id, emission_id, source_item_key, source_ticket_id,
            idv_externo, wintour_sale_number,
            source_fingerprint, source_snapshot, state, blocked_reasons,
            version, updated_at
     from wintour_sale_links where tenant_id = $1 and id = $2 for update`,
    [tenantId, id],
  )
  if (!result.rows[0]) throw notFound('venda')
  return result.rows[0]
}

async function assertNoActiveJob(client: PoolClient, tenantId: string, saleLinkId: string): Promise<void> {
  const result = await client.query<{ id: string }>(
    `select id from wintour_sync_jobs
     where tenant_id = $1 and sale_link_id = $2
       and state in ('ready', 'sending', 'ambiguous', 'received', 'processing', 'manual_review')
     limit 1 for update`,
    [tenantId, saleLinkId],
  )
  if (result.rows[0]) {
    throw new WintourSyncError(
      'WINTOUR_ACTIVE_JOB_EXISTS',
      'Ja existe um job Wintour ativo para esta venda.',
      409,
      { jobId: result.rows[0].id },
    )
  }
}

async function insertPreparedJob(
  client: PoolClient,
  principal: RequestPrincipal,
  input: {
    link: SaleLinkRow
    operation: 'create' | 'update'
    linkSourceFingerprint: string
    configFingerprint: string
    sourceFingerprint: string
    sourceSnapshot: Record<string, unknown>
    idempotencyKey: string
    maxAttempts: number
    artifact: PreparedArtifact
  },
): Promise<JobRow> {
  const result = await client.query<JobRow>(
     `insert into wintour_sync_jobs (
       tenant_id, sale_link_id, company_id, emission_id, operation,
       link_source_fingerprint, config_fingerprint, source_fingerprint,
       source_snapshot, idempotency_key, file_number,
       payload_bytes, payload_sha256, payload_filename, payload_content_type,
       serializer_version, transport_free_field, state,
       blocked_reasons, max_attempts, created_by, updated_by
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14,
       'application/xml', $15, $16, 'ready', '[]'::jsonb, $17, $18, $18
     )
     on conflict (tenant_id, idempotency_key) do nothing
     returning id, sale_link_id, operation, state, attempt_count, max_attempts,
               last_error_code, version, prepared_at, updated_at, payload_bytes`,
    [
      principal.tenantId,
      input.link.id,
      input.link.company_id,
      input.link.emission_id,
      input.operation,
      input.linkSourceFingerprint,
      input.configFingerprint,
      input.sourceFingerprint,
      JSON.stringify(input.sourceSnapshot),
      input.idempotencyKey,
      input.artifact.fileNumber,
      Buffer.from(input.artifact.bytes),
      input.artifact.sha256,
      input.artifact.filename,
      input.artifact.serializerVersion,
      nullableString(objectValue(input.sourceSnapshot.configuration).freeField),
      input.maxAttempts,
      principal.user.id,
    ],
  )
  if (result.rows[0]) return result.rows[0]
  const replay = await findJobByIdempotencyKey(client, principal.tenantId, input.idempotencyKey)
  if (!replay) throw new WintourSyncError('WINTOUR_JOB_INSERT_FAILED', 'Nao foi possivel preparar o job.', 409)
  return replay
}

async function findJobByIdempotencyKey(
  client: PoolClient,
  tenantId: string,
  idempotencyKey: string,
): Promise<JobRow | null> {
  const result = await client.query<JobRow>(
    `select id, sale_link_id, operation, state, attempt_count, max_attempts,
            last_error_code, version, prepared_at, updated_at, payload_bytes,
            payload_sha256, payload_filename, payload_content_type, serializer_version
     from wintour_sync_jobs where tenant_id = $1 and idempotency_key = $2`,
    [tenantId, idempotencyKey],
  )
  return result.rows[0] || null
}

function preparationConfiguration(
  settings: SettingsRow,
  operation: 'create' | 'update',
  linkSnapshot: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    serializerVersion: operation === 'create'
      ? WINTOUR_CREATION_SERIALIZER
      : WINTOUR_UPDATE_SERIALIZER,
    agencyName: settings.agency_name,
    branchId: settings.branch_id === null ? null : numberValue(settings.branch_id),
    branchName: settings.branch_name,
    freeField: settings.free_field,
    productCodes: objectValue(settings.product_codes),
    paymentMethodCodes: objectValue(settings.payment_method_codes),
    serviceRouteTypes: objectValue(settings.service_route_types),
    tariffNetDefault: settings.tariff_net_default === null
      ? null
      : numberValue(settings.tariff_net_default),
    accountDefaults: objectValue(settings.account_defaults),
    customerAction: settings.customer_action,
    generationTimeZone: WINTOUR_GENERATION_TIME_ZONE,
    saleMappings: operation === 'create' ? objectValue(linkSnapshot.mappings) : {},
  }
}

type PreparedArtifactInput = {
  operation: 'create' | 'update'
  settings: SettingsRow
  link: SaleLinkRow
  sourceSnapshot: Record<string, unknown>
  configSnapshot: Record<string, unknown>
  fileNumber: string
  generationAt: Date
}

function buildPreparedArtifact(input: PreparedArtifactInput): PreparedArtifact {
  try {
    return buildPreparedArtifactUnchecked(input)
  } catch (error) {
    if (error instanceof WintourXmlValidationError) {
      throw new WintourSyncError(
        'WINTOUR_ARTIFACT_XML_INVALID',
        'Os dados canonicos nao podem ser serializados no arquivo Wintour.',
        422,
        { blockedReason: 'artifact_xml_validation_failed' },
      )
    }
    throw error
  }
}

function buildPreparedArtifactUnchecked(input: PreparedArtifactInput): PreparedArtifact {
  let wintourFileInput: WintourCreationFile | WintourUpdateFile
  let xml: string
  let serializerVersion: string
  if (input.operation === 'update') {
    const changes = Array.isArray(input.sourceSnapshot.changes) ? input.sourceSnapshot.changes : []
    wintourFileInput = {
      recalculateCalculatedFields: input.sourceSnapshot.recalculateCalculatedFields ? 'S' : 'N',
      sales: [{
        nr: Number(input.link.wintour_sale_number),
        changes: changes as WintourUpdateFile['sales'][number]['changes'],
      }],
    }
    xml = buildWintourUpdateXml(wintourFileInput)
    serializerVersion = WINTOUR_UPDATE_SERIALIZER
  } else {
    const rawSale = input.sourceSnapshot.wintourSaleInput
    if (!rawSale || typeof rawSale !== 'object' || Array.isArray(rawSale)) {
      throw new WintourSyncError(
        'WINTOUR_CREATION_PAYLOAD_INCOMPLETE',
        'A fonte relacional ainda nao possui todos os campos canonicos da venda Wintour.',
        422,
        { blockedReason: 'creation_sale_input_missing' },
      )
    }
    const emission = objectValue(input.sourceSnapshot.emission)
    const mappings = objectValue(input.configSnapshot.saleMappings)
    const service = wintourServiceKey(String(emission.serviceType || ''))
    const products = objectValue(input.settings.product_codes)
    const routes = objectValue(input.settings.service_route_types)
    const accounts = objectValue(input.settings.account_defaults)
    const paymentCodes = objectValue(input.settings.payment_method_codes)
    const internalPaymentMethod = nullableString(emission.paymentMethod)
    const paymentMethod = internalPaymentMethod
      ? nullableString(paymentCodes[internalPaymentMethod])
      : null
    const configurationBlocker = input.settings.customer_action !== 'none'
      ? 'customer_data_mapping_unsupported'
      : paymentMethod && WINTOUR_SPLIT_PAYMENT_METHODS.has(paymentMethod)
        ? 'payment_split_mapping_unsupported'
        : paymentMethod && WINTOUR_CP_ACCOUNT_METHODS.has(paymentMethod)
            && !boundedText(accounts.card_cp, 10)
          ? 'payment_card_cp_account_missing'
          : paymentMethod && WINTOUR_MP_ACCOUNT_METHODS.has(paymentMethod)
              && !boundedText(accounts.card_mp, 10)
            ? 'payment_card_mp_account_missing'
            : null
    if (!service || typeof products[service] !== 'string' || typeof routes[service] !== 'number'
        || input.settings.tariff_net_default === null
        || configurationBlocker
        || !paymentMethod
        || !new Set<string>(WINTOUR_PAYMENT_METHODS).has(paymentMethod)
        || typeof mappings.companyCode !== 'string'
        || typeof mappings.emissorCode !== 'string') {
      throw new WintourSyncError(
        'WINTOUR_CREATION_MAPPING_INCOMPLETE',
        'Os de-para obrigatorios da venda Wintour estao incompletos.',
        422,
        { blockedReason: configurationBlocker || 'creation_mapping_incomplete' },
      )
    }
    const issuedAt = new Date(String(emission.issuedAt || ''))
    if (!Number.isFinite(issuedAt.getTime())) {
      throw new WintourSyncError('WINTOUR_CREATION_DATE_INVALID', 'Data da emissao invalida.', 422)
    }
    const sale: Record<string, unknown> = {
      ...(rawSale as Record<string, unknown>),
      idv_externo: Number(input.link.idv_externo),
      id_posto_atendimento: input.settings.branch_id === null
        ? undefined
        : numberValue(input.settings.branch_id),
      posto_atendimento: input.settings.branch_name || undefined,
      codigo_produto: products[service],
      emissor: mappings.emissorCode,
      cliente: mappings.companyCode,
      forma_de_pagamento: paymentMethod,
      cartao_cp: WINTOUR_CP_ACCOUNT_METHODS.has(paymentMethod)
        ? boundedText(accounts.card_cp, 10) || undefined
        : undefined,
      cartao_mp: WINTOUR_MP_ACCOUNT_METHODS.has(paymentMethod)
        ? boundedText(accounts.card_mp, 10) || undefined
        : undefined,
      tarifa_net: numberValue(input.settings.tariff_net_default),
      tipo_roteiro: routes[service],
      promotor: nullableString(accounts.promoter) || undefined,
      gerente: nullableString(accounts.manager) || undefined,
      fornecedor: (rawSale as Record<string, unknown>).fornecedor
        || nullableString(accounts.supplier) || undefined,
      ccustos_agencia: (rawSale as Record<string, unknown>).ccustos_agencia
        || nullableString(accounts.agency_cost_center) || undefined,
    }
    if (service === 'air') {
      sale.num_bilhete = emission.sourceTicketNumber
      sale.passageiro = emission.passengerName
    }
    wintourFileInput = {
      nr_arquivo: Number(input.fileNumber),
      data_geracao: wintourDate(input.generationAt, WINTOUR_GENERATION_TIME_ZONE),
      hora_geracao: wintourTime(input.generationAt, WINTOUR_GENERATION_TIME_ZONE),
      nome_agencia: input.settings.agency_name,
      vendas: [sale as unknown as WintourCreationFile['vendas'][number]],
    }
    xml = buildWintourCreationXml(wintourFileInput)
    serializerVersion = WINTOUR_CREATION_SERIALIZER
  }
  const bytes = encodeWintourIso88591(xml)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    fileNumber: input.fileNumber,
    bytes,
    sha256,
    filename: `wintour-${input.operation}-${input.fileNumber}.xml`,
    serializerVersion,
    sourceSnapshot: {
      source: input.sourceSnapshot,
      configuration: input.configSnapshot,
      generationAtUtc: input.generationAt.toISOString(),
      wintourFileInput,
    },
  }
}

function wintourDate(value: Date, timeZone = 'UTC'): string {
  const parts = zonedDateTimeParts(value, timeZone)
  return `${parts.day}/${parts.month}/${parts.year}`
}

function wintourTime(value: Date, timeZone = 'UTC'): string {
  const parts = zonedDateTimeParts(value, timeZone)
  return `${parts.hour}:${parts.minute}`
}

function zonedDateTimeParts(value: Date, timeZone: string): Record<'day' | 'month' | 'year' | 'hour' | 'minute', string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return {
    day: read('day'),
    month: read('month'),
    year: read('year'),
    hour: read('hour'),
    minute: read('minute'),
  }
}

async function bumpLinkReady(
  client: PoolClient,
  principal: RequestPrincipal,
  link: SaleLinkRow,
): Promise<void> {
  const updated = await client.query(
    `update wintour_sale_links
     set state = 'ready', blocked_reasons = '[]'::jsonb,
         updated_by = $3, version = version + 1
     where tenant_id = $1 and id = $2 and version = $4
     returning id`,
    [principal.tenantId, link.id, principal.user.id, numberValue(link.version)],
  )
  if (!updated.rows[0]) throw versionConflict(numberValue(link.version), null)
}

async function nextTenantNumber(
  client: PoolClient,
  tenantId: string,
  sequenceKey: string,
): Promise<string> {
  const result = await client.query<{ current_value: string | number }>(
    `insert into tenant_number_sequences (tenant_id, sequence_key, current_value)
     values ($1, $2, 1)
     on conflict (tenant_id, sequence_key) do update set
       current_value = tenant_number_sequences.current_value + 1,
       updated_at = now()
     returning current_value`,
    [tenantId, sequenceKey],
  )
  const next = String(result.rows[0].current_value)
  const maximum = sequenceKey === WINTOUR_IDV_SEQUENCE ? 9_999_999_999 : 2_147_483_647
  if (!/^\d+$/.test(next) || BigInt(next) > BigInt(maximum)) {
    throw new WintourSyncError(
      'WINTOUR_SEQUENCE_EXHAUSTED',
      'A sequencia numerica Wintour atingiu o limite suportado.',
      409,
      { sequenceKey },
    )
  }
  return next
}

async function loadCompanyMappings(
  client: PoolClient,
  tenantId: string,
  companyIds: string[] | null = null,
): Promise<Array<{ companyId: string; wintourAccountCode: string }>> {
  const result = await client.query<{ company_id: string; provider_company_id: string }>(
    `select company_id, provider_company_id
     from integration_company_mappings
     where tenant_id = $1 and provider = $2
       and mapping_type = 'provider_company' and status = 'active'
       and ($3::text[] is null or company_id = any($3::text[]))
     order by company_id`,
    [tenantId, WINTOUR_PROVIDER, companyIds],
  )
  return result.rows.map((mapping) => ({
    companyId: mapping.company_id,
    wintourAccountCode: mapping.provider_company_id,
  }))
}

async function loadCurrentSaleMappings(
  client: PoolClient,
  tenantId: string,
  link: { emission_id?: string; company_id?: string },
  strict = true,
): Promise<Record<string, unknown>> {
  if (!link.emission_id || !link.company_id) throw notFound('venda')
  const result = await client.query<{
    company_code: string | null
    actor_mapping_count: number | string
    emissor_code: string | null
  }>(
    `select company_mapping.provider_company_id as company_code,
            actor.mapping_count as actor_mapping_count,
            actor.external_actor_code as emissor_code
     from travel_emissions emission
     left join integration_company_mappings company_mapping
       on company_mapping.tenant_id = emission.tenant_id
      and company_mapping.company_id = emission.company_id
      and company_mapping.provider = $4
      and company_mapping.mapping_type = 'provider_company'
      and company_mapping.status = 'active'
     left join lateral (
       select count(*)::integer as mapping_count,
              case when count(*) = 1 then min(mapping.external_actor_code) end
                as external_actor_code
       from integration_actor_mappings mapping
       where mapping.tenant_id = emission.tenant_id
         and mapping.provider_key = $4
         and mapping.user_id = emission.issued_by
         and mapping.status = 'active'
     ) actor on true
     where emission.tenant_id = $1 and emission.id = $2 and emission.company_id = $3`,
    [tenantId, link.emission_id, link.company_id, WINTOUR_PROVIDER],
  )
  const row = result.rows[0]
  if (!row?.company_code) {
    if (!strict) return { companyCode: null, emissorCode: null, state: 'company_mapping_missing' }
    throw new WintourSyncError(
      'WINTOUR_CREATION_MAPPING_INCOMPLETE',
      'A empresa nao possui de-para Wintour ativo.',
      422,
      { blockedReason: 'company_mapping_missing' },
    )
  }
  if (numberValue(row.actor_mapping_count || 0) !== 1 || !row.emissor_code) {
    if (!strict) {
      return {
        companyCode: row.company_code,
        emissorCode: null,
        state: numberValue(row.actor_mapping_count || 0) > 1
          ? 'emissor_mapping_ambiguous'
          : 'emissor_mapping_missing',
      }
    }
    throw new WintourSyncError(
      'WINTOUR_CREATION_MAPPING_INCOMPLETE',
      'O emissor nao possui de-para Wintour unico e ativo.',
      422,
      { blockedReason: numberValue(row.actor_mapping_count || 0) > 1
        ? 'emissor_mapping_ambiguous'
        : 'emissor_mapping_missing' },
    )
  }
  return { companyCode: row.company_code, emissorCode: row.emissor_code }
}

async function replaceCompanyMappings(
  client: PoolClient,
  principal: RequestPrincipal,
  mappings: Array<{ companyId: string; wintourAccountCode: string }>,
): Promise<void> {
  const companyIds = mappings.map((mapping) => mapping.companyId)
  const accountCodes = mappings.map((mapping) => mapping.wintourAccountCode)
  if (new Set(companyIds).size !== companyIds.length || new Set(accountCodes).size !== accountCodes.length) {
    throw new WintourSyncError(
      'WINTOUR_COMPANY_MAPPING_DUPLICATE',
      'Empresas e codigos Wintour nao podem ser duplicados.',
      400,
    )
  }
  if (companyIds.length) {
    const companies = await client.query<{ id: string }>(
      `select id from companies
       where tenant_id = $1 and id = any($2::text[]) and deleted_at is null
       for share`,
      [principal.tenantId, companyIds],
    )
    if (companies.rows.length !== companyIds.length) {
      throw new WintourSyncError(
        'WINTOUR_COMPANY_MAPPING_SCOPE_INVALID',
        'Uma ou mais empresas nao pertencem ao tenant ou estao removidas.',
        422,
      )
    }
  }
  await client.query(
    `update integration_company_mappings
     set status = 'inactive', updated_by = $3, updated_at = now()
     where tenant_id = $1 and provider = $2 and mapping_type = 'provider_company'
       and status = 'active'
       and ($4::text[] is null or company_id <> all($4::text[]))`,
    [principal.tenantId, WINTOUR_PROVIDER, principal.user.id, companyIds.length ? companyIds : null],
  )
  for (const mapping of mappings) {
    const current = await client.query<{ id: string }>(
      `select id from integration_company_mappings
       where tenant_id = $1 and company_id = $2 and provider = $3
         and mapping_type = 'provider_company'
       order by created_at desc, id desc limit 1 for update`,
      [principal.tenantId, mapping.companyId, WINTOUR_PROVIDER],
    )
    if (current.rows[0]) {
      await client.query(
        `update integration_company_mappings
         set provider_company_id = $3, status = 'active', updated_by = $4, updated_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, current.rows[0].id, mapping.wintourAccountCode, principal.user.id],
      )
    } else {
      await client.query(
        `insert into integration_company_mappings (
           tenant_id, company_id, provider, provider_company_id, status,
           mapping_type, metadata, created_by, updated_by
         ) values ($1, $2, $3, $4, 'active', 'provider_company', $5::jsonb, $6, $6)`,
        [
          principal.tenantId,
          mapping.companyId,
          WINTOUR_PROVIDER,
          mapping.wintourAccountCode,
          JSON.stringify({ source: 'wintour_sync_settings' }),
          principal.user.id,
        ],
      )
    }
  }
}

type CanonicalEmissionLockRow = {
  reservation_id: string
  demand_id: string
  requester_id: string | null
  cost_center_id: string | null
  issued_by: string | null
}

async function lockCanonicalEmissionTables(client: PoolClient): Promise<void> {
  // Row locks cannot prevent phantom sibling facts. EXCLUSIVE NOWAIT is the
  // first statement in the one-job claim transaction: plain reads continue,
  // while any writer/row-lock makes this claim abort and retry without waiting.
  await client.query(
    `lock table
       air_demand_details,
       air_emission_tickets,
       air_reservation_details,
       air_reservation_segments,
       cost_centers,
       demand_travelers,
       demands,
       employees,
       geo_airports,
       integration_actor_mappings,
       integration_company_mappings,
       requesters,
       reservations,
       travel_emissions,
       wintour_sync_settings
     in exclusive mode nowait`,
  )
}

async function lockCanonicalEmissionFacts(
  client: PoolClient,
  input: {
    tenantId: string
    companyId: string
    emissionId: string
    sourceTicketId: string | null
  },
): Promise<boolean> {
  const core = await client.query<CanonicalEmissionLockRow>(
    `select emission.reservation_id, emission.demand_id, emission.issued_by,
            demand.requester_id, demand.cost_center_id
     from travel_emissions emission
     join reservations reservation
       on reservation.tenant_id = emission.tenant_id
      and reservation.id = emission.reservation_id
     join demands demand
       on demand.tenant_id = emission.tenant_id
      and demand.id = emission.demand_id
      and demand.company_id = emission.company_id
      and demand.id = reservation.demand_id
     where emission.tenant_id = $1 and emission.id = $2 and emission.company_id = $3
     for share of emission, reservation, demand nowait`,
    [input.tenantId, input.emissionId, input.companyId],
  )
  const locked = core.rows[0]
  if (!locked) return false

  if (locked.requester_id) {
    await client.query(
      `select requester.id from requesters requester
       where requester.tenant_id = $1 and requester.id = $2
         and requester.company_id = $3
       for share nowait`,
      [input.tenantId, locked.requester_id, input.companyId],
    )
  }
  if (locked.cost_center_id) {
    await client.query(
      `select cost_center.id from cost_centers cost_center
       where cost_center.tenant_id = $1 and cost_center.id = $2
         and cost_center.company_id = $3
       for share nowait`,
      [input.tenantId, locked.cost_center_id, input.companyId],
    )
  }

  const tickets = await client.query<{ id: string; demand_traveler_id: string | null }>(
    `select ticket.id, ticket.demand_traveler_id
     from air_emission_tickets ticket
     where ticket.tenant_id = $1 and ticket.emission_id = $2
     order by ticket.id
     for share nowait`,
    [input.tenantId, input.emissionId],
  )
  const selectedTicket = input.sourceTicketId
    ? tickets.rows.find((ticket) => ticket.id === input.sourceTicketId)
    : null
  if (input.sourceTicketId && !selectedTicket) return false

  if (selectedTicket?.demand_traveler_id) {
    const travelers = await client.query<{ employee_id: string | null }>(
      `select traveler.employee_id
       from demand_travelers traveler
       where traveler.tenant_id = $1 and traveler.id = $2 and traveler.demand_id = $3
       for share nowait`,
      [input.tenantId, selectedTicket.demand_traveler_id, locked.demand_id],
    )
    const employeeId = travelers.rows[0]?.employee_id
    if (employeeId) {
      await client.query(
        `select employee.id from employees employee
         where employee.tenant_id = $1 and employee.id = $2 and employee.company_id = $3
         for share nowait`,
        [input.tenantId, employeeId, input.companyId],
      )
    }
  }

  await client.query(
    `select air.reservation_id from air_reservation_details air
     where air.tenant_id = $1 and air.reservation_id = $2
     for share nowait`,
    [input.tenantId, locked.reservation_id],
  )
  await client.query(
    `select detail.demand_id from air_demand_details detail
     where detail.tenant_id = $1 and detail.demand_id = $2
     for share nowait`,
    [input.tenantId, locked.demand_id],
  )
  const segments = await client.query<{ origin_code: string; destination_code: string }>(
    `select segment.origin_code, segment.destination_code
     from air_reservation_segments segment
     where segment.tenant_id = $1 and segment.reservation_id = $2
     order by segment.id
     for share nowait`,
    [input.tenantId, locked.reservation_id],
  )
  const airportCodes = uniqueStrings(segments.rows.flatMap((segment) => [
    segment.origin_code.toUpperCase(),
    segment.destination_code.toUpperCase(),
  ]))
  if (airportCodes.length) {
    await client.query(
      `select airport.id from geo_airports airport
       where upper(airport.iata_code::text) = any($1::text[])
       order by airport.id
       for share nowait`,
      [airportCodes],
    )
  }

  await client.query(
    `select mapping.id from integration_company_mappings mapping
     where mapping.tenant_id = $1 and mapping.company_id = $2
       and mapping.provider = $3 and mapping.mapping_type = 'provider_company'
     order by mapping.id
     for share nowait`,
    [input.tenantId, input.companyId, WINTOUR_PROVIDER],
  )
  if (locked.issued_by) {
    await client.query(
      `select mapping.id from integration_actor_mappings mapping
       where mapping.tenant_id = $1 and mapping.provider_key = $2
         and mapping.user_id = $3
       order by mapping.id
       for share nowait`,
      [input.tenantId, WINTOUR_PROVIDER, locked.issued_by],
    )
  }
  return true
}

async function loadCanonicalEmissionCandidate(
  client: PoolClient,
  input: {
    tenantId: string
    companyId: string
    emissionId: string
    sourceTicketId: string | null
  },
): Promise<EmissionCandidateRow | null> {
  // The caller already owns the settings row through requireEnabledSettings(... FOR UPDATE).
  if (!await lockCanonicalEmissionFacts(client, input)) return null

  const result = await client.query<EmissionCandidateRow>(
    `select emission.id, emission.company_id, emission.provider,
            emission.provider_emission_id, emission.ticket_number, emission.status,
            emission.gross_amount::text, emission.tax_amount::text,
            emission.final_amount::text, emission.currency, emission.issued_by,
            emission.issued_at, emission.created_at as emission_created_at,
            emission.updated_at as emission_updated_at,
            reservation.service_type, reservation.id as reservation_id,
            reservation.currency as reservation_currency,
            reservation.gross_amount::text as reservation_gross_amount,
            reservation.tax_amount::text as reservation_tax_amount,
            reservation.final_amount::text as reservation_final_amount,
            reservation.updated_at as reservation_updated_at,
            demand.id as demand_id, demand.demand_number,
            demand.created_at as demand_created_at,
            demand.updated_at as demand_updated_at,
            case when requester.deleted_at is null then requester.name end as requester_name,
            case when cost_center.deleted_at is null then cost_center.code end as cost_center_code,
            emission.metadata #>> '{payment,method}' as payment_method,
            case when ticket.id is null then 'emission' else 'air-ticket:' || ticket.id::text end
              as source_item_key,
            ticket.id as source_ticket_id, ticket.passenger_name,
            ticket.ticket_number as source_ticket_number,
            ticket.status as source_ticket_status,
            ticket.currency as ticket_currency, ticket.issued_at as ticket_issued_at,
            ticket.updated_at as ticket_updated_at,
            ticket.issuing_airline_code, ticket.issuing_airline_name,
            case when traveler.deleted_at is null then traveler.birth_date_snapshot end
              as birth_date_snapshot,
            case when traveler.deleted_at is null then traveler.name_snapshot end
              as traveler_name,
            case when employee.deleted_at is null then employee.department end
              as employee_department,
            case when employee.deleted_at is null then employee.registration_code end
              as employee_registration_code,
            ticket_stats.ticket_count,
            ticket.fare_amount_minor as ticket_fare_amount_minor,
            ticket.tax_amount_minor as ticket_tax_amount_minor,
            ticket.total_amount_minor as ticket_total_amount_minor,
            ticket_stats.fare_total_minor as tickets_fare_total_minor,
            ticket_stats.tax_total_minor as tickets_tax_total_minor,
            ticket_stats.total_minor as tickets_total_minor,
            ticket_stats.non_issued_ticket_count,
            air.locator as air_locator, air.currency as air_currency,
            air.fare_amount_minor as air_fare_amount_minor,
            air.tax_amount_minor as air_tax_amount_minor,
            air.rav_amount_minor as air_rav_amount_minor,
            air.rac_amount_minor as air_rac_amount_minor,
            air.total_amount_minor as air_total_amount_minor,
            air.version as air_details_version,
            air.updated_at as air_details_updated_at,
            route.air_segments, air_demand.trip_type as air_trip_type,
            company_mapping.provider_company_id,
            actor_mapping.mapping_count as actor_mapping_count,
            actor_mapping.external_actor_code,
            wintour_sale_source_freshness_at(
              emission.tenant_id, emission.id, ticket.id, emission.company_id
            ) as source_freshness_at,
            false as source_refresh_needed
     from travel_emissions emission
     join reservations reservation
       on reservation.tenant_id = emission.tenant_id and reservation.id = emission.reservation_id
     join demands demand
       on demand.tenant_id = emission.tenant_id and demand.id = emission.demand_id
      and demand.company_id = emission.company_id and demand.id = reservation.demand_id
     join wintour_sync_settings source_settings
       on source_settings.tenant_id = emission.tenant_id
     left join requesters requester
       on requester.tenant_id = demand.tenant_id and requester.id = demand.requester_id
      and requester.company_id = demand.company_id
     left join cost_centers cost_center
       on cost_center.tenant_id = demand.tenant_id and cost_center.id = demand.cost_center_id
      and cost_center.company_id = demand.company_id
     left join air_emission_tickets ticket
       on ticket.tenant_id = emission.tenant_id and ticket.emission_id = emission.id
      and ticket.id = $4::uuid and reservation.service_type = 'aereo'
     left join demand_travelers traveler
       on traveler.tenant_id = ticket.tenant_id and traveler.id = ticket.demand_traveler_id
      and traveler.demand_id = demand.id
     left join employees employee
       on employee.tenant_id = traveler.tenant_id and employee.id = traveler.employee_id
      and employee.company_id = demand.company_id
     left join air_reservation_details air
       on air.tenant_id = reservation.tenant_id and air.reservation_id = reservation.id
     left join air_demand_details air_demand
       on air_demand.tenant_id = demand.tenant_id and air_demand.demand_id = demand.id
     left join lateral (
       select jsonb_agg(jsonb_build_object(
                'id', segment.id,
                'sequence', segment.sequence,
                'airlineCode', segment.airline_code,
                'flightNumber', segment.flight_number,
                'bookingClass', segment.booking_class,
                'status', segment.status,
                'originCode', segment.origin_code,
                'destinationCode', segment.destination_code,
                'departsAt', segment.departs_at,
                'arrivesAt', segment.arrives_at,
                'updatedAt', segment.updated_at,
                'originTimezone', origin_airport.timezone,
                'originCountryCode', origin_airport.country_code,
                'destinationTimezone', destination_airport.timezone,
                'destinationCountryCode', destination_airport.country_code
              ) order by segment.sequence) as air_segments
       from air_reservation_segments segment
       left join lateral (
         select case when count(*) > 0 and count(*) = count(airport.timezone)
                          and count(distinct airport.timezone) = 1
                  then min(airport.timezone) end as timezone,
                case when count(*) > 0 and count(*) = count(airport.country_code)
                          and count(distinct upper(airport.country_code::text)) = 1
                  then min(upper(airport.country_code::text)) end as country_code
         from geo_airports airport
         where airport.is_active and upper(airport.iata_code::text) = segment.origin_code
       ) origin_airport on true
       left join lateral (
         select case when count(*) > 0 and count(*) = count(airport.timezone)
                          and count(distinct airport.timezone) = 1
                  then min(airport.timezone) end as timezone,
                case when count(*) > 0 and count(*) = count(airport.country_code)
                          and count(distinct upper(airport.country_code::text)) = 1
                  then min(upper(airport.country_code::text)) end as country_code
         from geo_airports airport
         where airport.is_active and upper(airport.iata_code::text) = segment.destination_code
       ) destination_airport on true
       where segment.tenant_id = reservation.tenant_id
         and segment.reservation_id = reservation.id
     ) route on true
     left join lateral (
       select count(*)::integer as ticket_count,
              sum(item.fare_amount_minor)::bigint as fare_total_minor,
              sum(item.tax_amount_minor)::bigint as tax_total_minor,
              sum(item.total_amount_minor)::bigint as total_minor,
              count(*) filter (where item.status <> 'issued')::integer
                as non_issued_ticket_count
       from air_emission_tickets item
       where item.tenant_id = emission.tenant_id and item.emission_id = emission.id
     ) ticket_stats on true
     left join integration_company_mappings company_mapping
       on company_mapping.tenant_id = emission.tenant_id
      and company_mapping.company_id = emission.company_id
      and company_mapping.provider = $5
      and company_mapping.mapping_type = 'provider_company'
      and company_mapping.status = 'active'
     left join lateral (
       select count(*)::integer as mapping_count,
              case when count(*) = 1 then min(mapping.external_actor_code) end
                as external_actor_code
       from integration_actor_mappings mapping
       where mapping.tenant_id = emission.tenant_id
         and mapping.provider_key = $5
         and mapping.user_id = emission.issued_by
         and mapping.status = 'active'
     ) actor_mapping on true
     where emission.tenant_id = $1 and emission.id = $2 and emission.company_id = $3
       and emission.issued_at >= source_settings.sync_from
       and emission.provider = 'manual-offline'
       and lower(emission.provider) <> $5
       and lower(coalesce(emission.metadata ->> 'source', '')) not in ('wintour', 'wintour_import')
       and (reservation.service_type <> 'aereo' or ticket.id is not null)
       and ($4::uuid is null or ticket.id is not null)`,
    [
      input.tenantId,
      input.emissionId,
      input.companyId,
      input.sourceTicketId,
      WINTOUR_PROVIDER,
    ],
  )
  return result.rows[0] || null
}

function accountDefaultsToDatabase(value: WintourSyncSettingsInput['accountDefaults']): Record<string, unknown> {
  return {
    issuer: value.issuer,
    promoter: value.promoter,
    manager: value.manager,
    supplier: value.supplier,
    agency_cost_center: value.agencyCostCenter,
    card_cp: value.cardCp,
    card_mp: value.cardMp,
    additional_fee: value.additionalFee,
    additional_fee_2: value.additionalFee2,
    issuance_fee: value.issuanceFee,
  }
}

function buildCanonicalSale(candidate: EmissionCandidateRow, settings: SettingsRow): CanonicalSaleResult {
  const blockers: string[] = []
  const service = wintourServiceKey(candidate.service_type)
  if (candidate.provider !== 'manual-offline') blockers.push('source_provider_unsupported')
  if (candidate.status !== 'issued') {
    blockers.push('emission_status_not_exportable')
  }
  if (service !== 'air') {
    blockers.push(service ? `canonical_${service}_mapping_unavailable` : 'service_type_unsupported')
    return { sale: null, blockers }
  }
  if (!candidate.source_ticket_id) blockers.push('air_ticket_missing')
  if (candidate.source_ticket_status !== 'issued') blockers.push('air_ticket_status_not_issued')
  if (numberValue(candidate.non_issued_ticket_count || 0) > 0) {
    blockers.push('air_emission_contains_non_issued_ticket')
  }
  if (!candidate.air_trip_type) blockers.push('air_demand_details_missing')
  const ticketNumber = nullableString(candidate.source_ticket_number)?.trim() || null
  if (!ticketNumber || ticketNumber.length !== 10) {
    blockers.push('air_ticket_number_invalid_length')
  }
  const passengerName = boundedText(candidate.passenger_name, 60)
  if (!passengerName) blockers.push('air_passenger_missing_or_too_long')
  const travelerName = boundedText(candidate.traveler_name, 160)
  if (!candidate.source_ticket_id || !travelerName) blockers.push('air_traveler_missing')
  if (passengerName && travelerName
      && normalizedPersonName(passengerName) !== normalizedPersonName(travelerName)) {
    blockers.push('air_traveler_name_mismatch')
  }
  const providerName = boundedText(candidate.issuing_airline_name, 60)
  if (!providerName) blockers.push('air_provider_missing_or_too_long')
  const locator = boundedText(candidate.air_locator, 20)
  if (!locator) blockers.push('air_locator_missing_or_too_long')
  if ([candidate.currency, candidate.reservation_currency, candidate.ticket_currency, candidate.air_currency]
    .some((currency) => currency !== 'BRL')) blockers.push('currency_brl_required')
  const grossMinor = moneyMinor(candidate.gross_amount)
  const taxMinor = moneyMinor(candidate.tax_amount)
  const totalMinor = moneyMinor(candidate.final_amount)
  if (grossMinor <= 0 || taxMinor < 0 || totalMinor <= 0 || grossMinor + taxMinor !== totalMinor
      || moneyMinor(candidate.reservation_gross_amount) !== grossMinor
      || moneyMinor(candidate.reservation_tax_amount) !== taxMinor
      || moneyMinor(candidate.reservation_final_amount) !== totalMinor) {
    blockers.push('emission_amounts_inconsistent')
  }
  if (numberValue(candidate.air_rav_amount_minor || 0) !== 0
      || numberValue(candidate.air_rac_amount_minor || 0) !== 0) {
    blockers.push('air_rav_rac_allocation_unsupported')
  }
  const ticketCount = numberValue(candidate.ticket_count)
  let fareMinor = grossMinor
  let effectiveTaxMinor = taxMinor
  if (ticketCount > 1) {
    fareMinor = numberValue(candidate.ticket_fare_amount_minor || 0)
    effectiveTaxMinor = numberValue(candidate.ticket_tax_amount_minor || 0)
    const ticketTotal = numberValue(candidate.ticket_total_amount_minor || 0)
    if (fareMinor <= 0 || ticketTotal <= 0 || fareMinor + effectiveTaxMinor !== ticketTotal
        || numberValue(candidate.tickets_fare_total_minor || 0) !== grossMinor
        || numberValue(candidate.tickets_tax_total_minor || 0) !== taxMinor
        || numberValue(candidate.tickets_total_minor || 0) !== totalMinor) {
      blockers.push('air_ticket_amount_allocation_missing')
    }
  } else if (ticketCount === 1) {
    const ticketFare = numberValue(candidate.ticket_fare_amount_minor || 0)
    const ticketTax = numberValue(candidate.ticket_tax_amount_minor || 0)
    const ticketTotal = numberValue(candidate.ticket_total_amount_minor || 0)
    const usesOfflineSentinel = ticketFare === 0 && ticketTax === 0 && ticketTotal === 0
    if (!usesOfflineSentinel && (
      ticketFare !== grossMinor || ticketTax !== taxMinor || ticketTotal !== totalMinor
      || ticketFare + ticketTax !== ticketTotal
    )) {
      blockers.push('air_ticket_amount_allocation_inconsistent')
    }
  } else {
    blockers.push('air_ticket_count_invalid')
  }
  if (numberValue(candidate.air_total_amount_minor || 0) !== totalMinor
      || numberValue(candidate.air_fare_amount_minor || 0) !== grossMinor
      || numberValue(candidate.air_tax_amount_minor || 0) !== taxMinor) {
    blockers.push('air_reservation_amounts_inconsistent')
  }

  const payments = objectValue(settings.payment_method_codes)
  const payment = candidate.payment_method ? boundedText(payments[candidate.payment_method], 2) : null
  if (!candidate.payment_method) blockers.push('payment_method_missing')
  if (!payment || !new Set<string>(WINTOUR_PAYMENT_METHODS).has(payment)) {
    blockers.push('payment_mapping_missing')
  }
  const accounts = objectValue(settings.account_defaults)
  if (payment && WINTOUR_CP_ACCOUNT_METHODS.has(payment) && !boundedText(accounts.card_cp, 10)) {
    blockers.push('payment_card_cp_account_missing')
  }
  if (payment && WINTOUR_MP_ACCOUNT_METHODS.has(payment) && !boundedText(accounts.card_mp, 10)) {
    blockers.push('payment_card_mp_account_missing')
  }
  if (payment && WINTOUR_SPLIT_PAYMENT_METHODS.has(payment)) {
    blockers.push('payment_split_mapping_unsupported')
  }
  if (settings.customer_action !== 'none') blockers.push('customer_data_mapping_unsupported')

  const segments = Array.isArray(candidate.air_segments)
    ? candidate.air_segments.map((segment) => objectValue(segment))
    : []
  if (!segments.length) blockers.push('air_segments_missing')
  const legs: Array<Record<string, unknown>> = []
  const countries = new Set<string>()
  const segmentAirlines = new Set<string>()
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (Number(segment.sequence) !== index + 1 || segment.status !== 'issued') {
      blockers.push('air_segments_not_fully_issued_or_ordered')
      continue
    }
    const originTimeZone = boundedText(segment.originTimezone, 80)
    const destinationTimeZone = boundedText(segment.destinationTimezone, 80)
    const originCountry = boundedText(segment.originCountryCode, 2)
    const destinationCountry = boundedText(segment.destinationCountryCode, 2)
    if (!originTimeZone || !destinationTimeZone || !originCountry || !destinationCountry
        || !isValidTimeZone(originTimeZone) || !isValidTimeZone(destinationTimeZone)) {
      blockers.push('air_airport_timezone_missing_or_ambiguous')
      continue
    }
    const departsAt = new Date(String(segment.departsAt || ''))
    const arrivesAt = new Date(String(segment.arrivesAt || ''))
    if (!Number.isFinite(departsAt.getTime()) || !Number.isFinite(arrivesAt.getTime())) {
      blockers.push('air_segment_datetime_invalid')
      continue
    }
    countries.add(originCountry)
    countries.add(destinationCountry)
    const segmentAirline = boundedText(segment.airlineCode, 3)?.toUpperCase()
    if (segmentAirline) segmentAirlines.add(segmentAirline)
    legs.push({
      cia_iata: String(segment.airlineCode || ''),
      numero_voo: String(segment.flightNumber || ''),
      aeroporto_origem: String(segment.originCode || ''),
      aeroporto_destino: String(segment.destinationCode || ''),
      data_partida: wintourDate(departsAt, originTimeZone),
      hora_partida: wintourTime(departsAt, originTimeZone),
      data_chegada: wintourDate(arrivesAt, destinationTimeZone),
      hora_chegada: wintourTime(arrivesAt, destinationTimeZone),
      classe: String(segment.bookingClass || ''),
    })
  }
  if (segmentAirlines.size > 1) blockers.push('air_provider_ambiguous_across_segments')
  const issuingAirlineCode = boundedText(candidate.issuing_airline_code, 3)?.toUpperCase()
  if (segmentAirlines.size !== 1
      || !issuingAirlineCode
      || !segmentAirlines.has(issuingAirlineCode)) {
    blockers.push('air_provider_mismatch_with_segments')
  }
  const firstSegment = segments[0]
  const firstDeparture = new Date(String(firstSegment?.departsAt || ''))
  const firstTimeZone = boundedText(firstSegment?.originTimezone, 80)
  const passengerType = firstTimeZone && Number.isFinite(firstDeparture.getTime())
    ? wintourPassengerType(candidate.birth_date_snapshot, firstDeparture, firstTimeZone)
    : null
  if (!passengerType) blockers.push('air_passenger_birth_date_missing_or_invalid')

  const ticketIssuedAt = new Date(String(candidate.ticket_issued_at || ''))
  const emissionCreatedAt = new Date(String(candidate.emission_created_at))
  const demandCreatedAt = new Date(String(candidate.demand_created_at))
  if (!Number.isFinite(ticketIssuedAt.getTime()) || !Number.isFinite(emissionCreatedAt.getTime())
      || !Number.isFinite(demandCreatedAt.getTime())) {
    blockers.push('canonical_dates_invalid')
  }
  const optionalFields: Array<[unknown, number, string]> = [
    [candidate.requester_name, 100, 'requester_name_too_long'],
    [candidate.cost_center_code, 70, 'cost_center_code_too_long'],
    [candidate.demand_number, 20, 'demand_number_too_long'],
    [candidate.employee_department, 40, 'employee_department_too_long'],
    [candidate.employee_registration_code, 20, 'employee_registration_too_long'],
  ]
  for (const [value, maximum, reason] of optionalFields) {
    const text = nullableString(value)
    if (text && text.length > maximum) blockers.push(reason)
  }
  if (blockers.length) return { sale: null, blockers: uniqueStrings(blockers) }

  const sale: WintourCreationFile['vendas'][number] = {
    idv_externo: 1,
    dt_interna_cadastro: wintourDate(emissionCreatedAt, WINTOUR_GENERATION_TIME_ZONE),
    data_lancamento: wintourDate(ticketIssuedAt, WINTOUR_GENERATION_TIME_ZONE),
    codigo_produto: 'PENDING',
    prestador_svc: providerName!,
    num_bilhete: ticketNumber!,
    localizador: locator!,
    forma_de_pagamento: payment as WintourCreationFile['vendas'][number]['forma_de_pagamento'],
    cartao_cp: WINTOUR_CP_ACCOUNT_METHODS.has(payment!)
      ? boundedText(accounts.card_cp, 10)! : undefined,
    cartao_mp: WINTOUR_MP_ACCOUNT_METHODS.has(payment!)
      ? boundedText(accounts.card_mp, 10)! : undefined,
    moeda: 'BRL',
    ccustos_cliente: boundedText(candidate.cost_center_code, 70) || undefined,
    numero_requisicao: boundedText(candidate.demand_number, 20) || undefined,
    data_requisicao: wintourDate(demandCreatedAt, WINTOUR_GENERATION_TIME_ZONE),
    passageiro: passengerName!,
    tipo_passageiro: passengerType!,
    solicitante: boundedText(candidate.requester_name, 100) || undefined,
    departamento: boundedText(candidate.employee_department, 40) || undefined,
    matricula: boundedText(candidate.employee_registration_code, 20) || undefined,
    tipo_domest_inter: countries.size === 1 && countries.has('BR') ? 'D' : 'I',
    tipo_roteiro_aereo: candidate.air_trip_type === 'one_way'
      ? 'OW'
      : candidate.air_trip_type === 'round_trip' ? 'RT' : undefined,
    destino_rot_aereo: String(segments.at(-1)?.destinationCode || ''),
    tipo_roteiro: 1,
    tarifa_net: 0,
    valores: [
      { codigo: 'tarifa', valor: minorMoney(fareMinor) },
      ...(effectiveTaxMinor > 0 ? [{ codigo: 'taxa' as const, valor: minorMoney(effectiveTaxMinor) }] : []),
    ],
    roteiro: { aereo: { trechos: legs as WintourCreationFile['vendas'][number]['roteiro'] extends { aereo: infer A } ? A extends { trechos: infer T } ? T : never : never } },
  }
  return { sale, blockers: [] }
}

function discoveryBlockers(
  candidate: EmissionCandidateRow,
  settings: SettingsRow,
  canonicalBlockers: string[],
): string[] {
  const reasons: string[] = [...canonicalBlockers]
  if (!settings.enabled) reasons.push('settings_disabled')
  if (!candidate.provider_company_id) reasons.push('company_mapping_missing')
  if (!candidate.issued_by) reasons.push('emission_issuer_missing')
  const actorCount = numberValue(candidate.actor_mapping_count)
  if (candidate.issued_by && actorCount === 0) reasons.push('emissor_mapping_missing')
  if (actorCount > 1) reasons.push('emissor_mapping_ambiguous')
  const service = wintourServiceKey(candidate.service_type)
  if (!service) reasons.push('service_type_unsupported')
  const productCodes = objectValue(settings.product_codes)
  const routeTypes = objectValue(settings.service_route_types)
  if (service && typeof productCodes[service] !== 'string') reasons.push('product_mapping_missing')
  if (service && typeof routeTypes[service] !== 'number') reasons.push('route_type_mapping_missing')
  if (settings.tariff_net_default === null) reasons.push('tariff_net_default_missing')
  return uniqueStrings(reasons)
}

function emissionSnapshot(
  candidate: EmissionCandidateRow,
  sale: WintourCreationFile['vendas'][number] | null,
): Record<string, unknown> {
  return {
    sourceKind: 'travel_emission',
    emission: {
      id: candidate.id,
      companyId: candidate.company_id,
      provider: candidate.provider,
      providerEmissionId: candidate.provider_emission_id,
      ticketNumber: candidate.ticket_number,
      sourceItemKey: candidate.source_item_key,
      sourceTicketId: candidate.source_ticket_id,
      sourceTicketNumber: candidate.source_ticket_number,
      passengerName: candidate.passenger_name,
      serviceType: candidate.service_type,
      status: candidate.status,
      grossAmount: candidate.gross_amount,
      taxAmount: candidate.tax_amount,
      finalAmount: candidate.final_amount,
      currency: candidate.currency,
      paymentMethod: candidate.payment_method,
      issuedBy: candidate.issued_by,
      issuedAt: iso(candidate.issued_at),
      createdAt: iso(candidate.emission_created_at),
      updatedAt: iso(candidate.emission_updated_at),
      reservationUpdatedAt: iso(candidate.reservation_updated_at),
      demandId: candidate.demand_id,
      demandUpdatedAt: iso(candidate.demand_updated_at),
      ticketUpdatedAt: candidate.ticket_updated_at ? iso(candidate.ticket_updated_at) : null,
      ticketIssuedAt: candidate.ticket_issued_at ? iso(candidate.ticket_issued_at) : null,
      airDetailsVersion: candidate.air_details_version === null ? null : numberValue(candidate.air_details_version),
      airDetailsUpdatedAt: candidate.air_details_updated_at ? iso(candidate.air_details_updated_at) : null,
      airSegments: candidate.air_segments,
    },
    mappings: {
      companyCode: candidate.provider_company_id,
      emissorCode: candidate.external_actor_code,
    },
    wintourSaleInput: sale,
  }
}

function emissionSourceFingerprint(candidate: EmissionCandidateRow): Record<string, unknown> {
  return {
    sourceKind: 'travel_emission',
    emissionId: candidate.id,
    companyId: candidate.company_id,
    reservationId: candidate.reservation_id,
    sourceItemKey: candidate.source_item_key,
    sourceTicketId: candidate.source_ticket_id,
    provider: candidate.provider,
    providerEmissionId: candidate.provider_emission_id,
    serviceType: candidate.service_type,
    status: candidate.status,
    grossAmount: candidate.gross_amount,
    taxAmount: candidate.tax_amount,
    finalAmount: candidate.final_amount,
    currency: candidate.currency,
    paymentMethod: candidate.payment_method,
    issuedBy: candidate.issued_by,
    issuedAt: iso(candidate.issued_at),
    createdAt: iso(candidate.emission_created_at),
    updatedAt: iso(candidate.emission_updated_at),
    reservation: {
      currency: candidate.reservation_currency,
      grossAmount: candidate.reservation_gross_amount,
      taxAmount: candidate.reservation_tax_amount,
      finalAmount: candidate.reservation_final_amount,
      updatedAt: iso(candidate.reservation_updated_at),
    },
    demand: {
      id: candidate.demand_id,
      number: candidate.demand_number,
      createdAt: iso(candidate.demand_created_at),
      requesterName: candidate.requester_name,
      costCenterCode: candidate.cost_center_code,
      updatedAt: iso(candidate.demand_updated_at),
    },
    ticket: {
      number: candidate.source_ticket_number,
      status: candidate.source_ticket_status,
      passengerName: candidate.passenger_name,
      travelerName: candidate.traveler_name,
      issuingAirlineCode: candidate.issuing_airline_code,
      issuingAirlineName: candidate.issuing_airline_name,
      employeeDepartment: candidate.employee_department,
      employeeRegistrationCode: candidate.employee_registration_code,
      birthDate: candidate.birth_date_snapshot instanceof Date
        ? candidate.birth_date_snapshot.toISOString().slice(0, 10)
        : candidate.birth_date_snapshot,
      currency: candidate.ticket_currency,
      fareAmountMinor: candidate.ticket_fare_amount_minor,
      taxAmountMinor: candidate.ticket_tax_amount_minor,
      totalAmountMinor: candidate.ticket_total_amount_minor,
      ticketCount: candidate.ticket_count,
      ticketsFareTotalMinor: candidate.tickets_fare_total_minor,
      ticketsTaxTotalMinor: candidate.tickets_tax_total_minor,
      ticketsTotalMinor: candidate.tickets_total_minor,
      nonIssuedTicketCount: candidate.non_issued_ticket_count,
      issuedAt: candidate.ticket_issued_at ? iso(candidate.ticket_issued_at) : null,
      updatedAt: candidate.ticket_updated_at ? iso(candidate.ticket_updated_at) : null,
    },
    air: {
      locator: candidate.air_locator,
      currency: candidate.air_currency,
      fareAmountMinor: candidate.air_fare_amount_minor,
      taxAmountMinor: candidate.air_tax_amount_minor,
      ravAmountMinor: candidate.air_rav_amount_minor,
      racAmountMinor: candidate.air_rac_amount_minor,
      totalAmountMinor: candidate.air_total_amount_minor,
      version: candidate.air_details_version,
      updatedAt: candidate.air_details_updated_at ? iso(candidate.air_details_updated_at) : null,
      tripType: candidate.air_trip_type,
      segments: candidate.air_segments,
    },
  }
}

function boundedText(value: unknown, maximum: number): string | null {
  const text = nullableString(value)
  return text && text.length <= maximum ? text : null
}

function normalizedPersonName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

function minorMoney(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

function wintourPassengerType(
  birthDate: Date | string | null,
  departure: Date,
  timeZone: string,
): 'A' | 'C' | 'I' | null {
  const birth = birthDate instanceof Date
    ? birthDate.toISOString().slice(0, 10)
    : String(birthDate || '').slice(0, 10)
  const match = birth.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const departureParts = zonedDateTimeParts(departure, timeZone)
  let age = Number(departureParts.year) - Number(match[1])
  if (`${departureParts.month}-${departureParts.day}` < `${match[2]}-${match[3]}`) age -= 1
  if (age < 0 || age > 130) return null
  if (age < 2) return 'I'
  if (age < 12) return 'C'
  return 'A'
}

function wintourServiceKey(value: string): 'air' | 'hotel' | 'car' | 'bus' | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'aereo' || normalized === 'air') return 'air'
  if (normalized === 'hotelaria' || normalized === 'hotel') return 'hotel'
  if (normalized === 'locacao' || normalized === 'car') return 'car'
  if (normalized === 'rodoviario' || normalized === 'bus') return 'bus'
  return null
}

function moneyMinor(value: string): number {
  const match = value.match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return -1
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'))
}

function requireWintourPermission(principal: RequestPrincipal): void {
  if (principal.platformAdmin
      || principal.authenticationLevel === 'system'
      || principal.roleKey === 'tenant_admin'
      || principal.corporateAccess?.companies.some(
        (company) => company.permissions.gerenciar_integracoes,
      )
      || principal.user.permissoes?.gerenciar_integracoes) return
  throw new WintourSyncError(
    'WINTOUR_SYNC_DENIED',
    'Permissao insuficiente para gerenciar a sincronizacao Wintour.',
    403,
  )
}

function requireSettingsPermission(principal: RequestPrincipal): void {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return
  throw new WintourSyncError(
    'WINTOUR_SYNC_SETTINGS_DENIED',
    'Somente o administrador do tenant pode alterar a configuracao Wintour.',
    403,
  )
}

function companyScope(principal: RequestPrincipal): string[] | null {
  if (principal.platformAdmin
      || principal.authenticationLevel === 'system'
      || principal.roleKey === 'tenant_admin') return null
  const scoped = principal.corporateAccess
    ? uniqueStrings(principal.corporateAccess.companies
      .filter((company) => company.permissions.gerenciar_integracoes)
      .map((company) => company.companyId))
    : principal.user.permissoes?.gerenciar_integracoes
      ? uniqueStrings([
        ...(principal.user.empresa_ids || []),
        ...(principal.user.company_id ? [principal.user.company_id] : []),
      ])
      : []
  if (!scoped.length) {
    throw new WintourSyncError(
      'WINTOUR_SYNC_COMPANY_SCOPE_REQUIRED',
      'O usuario nao possui escopo corporativo para operar o Wintour.',
      403,
    )
  }
  return scoped
}

function assertCompanyAccess(principal: RequestPrincipal, companyId: string): void {
  const scope = companyScope(principal)
  if (scope !== null && !scope.includes(companyId)) {
    throw new WintourSyncError(
      'WINTOUR_SYNC_COMPANY_DENIED',
      'A empresa nao pertence ao escopo corporativo autorizado.',
      403,
    )
  }
}

function requireWorkerPermission(principal: RequestPrincipal): void {
  if (principal.authenticationLevel === 'system' || principal.platformAdmin) return
  requireWintourPermission(principal)
}

function mapSettings(
  row: SettingsRow,
  companyMappings: Array<{ companyId: string; wintourAccountCode: string }>,
): WintourSyncSettings {
  const products = objectValue(row.product_codes)
  const payments = objectValue(row.payment_method_codes)
  const routes = objectValue(row.service_route_types)
  const accounts = objectValue(row.account_defaults)
  return {
    enabled: row.enabled,
    syncFrom: iso(row.sync_from),
    agencyName: row.agency_name,
    branchId: row.branch_id === null ? null : numberValue(row.branch_id),
    branchName: row.branch_name,
    freeField: row.free_field,
    productCodes: {
      air: nullableString(products.air), hotel: nullableString(products.hotel),
      car: nullableString(products.car), bus: nullableString(products.bus),
    },
    paymentMethodCodes: {
      faturado: nullablePayment(payments.faturado), pix: nullablePayment(payments.pix),
      cartao_corporativo: nullablePayment(payments.cartao_corporativo),
      cartao_agencia: nullablePayment(payments.cartao_agencia),
      transferencia: nullablePayment(payments.transferencia), dinheiro: nullablePayment(payments.dinheiro),
      outro: nullablePayment(payments.outro),
    },
    serviceRouteTypes: {
      air: routes.air === 1 ? 1 : null,
      hotel: routes.hotel === 2 ? 2 : null,
      car: routes.car === 3 ? 3 : null,
      bus: routes.bus === 4 || routes.bus === 7 ? routes.bus : null,
    },
    tariffNetDefault: row.tariff_net_default === null
      ? null
      : numberValue(row.tariff_net_default) as 0 | 1,
    accountDefaults: {
      issuer: nullableString(accounts.issuer), promoter: nullableString(accounts.promoter),
      manager: nullableString(accounts.manager), supplier: nullableString(accounts.supplier),
      agencyCostCenter: nullableString(accounts.agency_cost_center),
      cardCp: nullableString(accounts.card_cp), cardMp: nullableString(accounts.card_mp),
      additionalFee: nullableString(accounts.additional_fee),
      additionalFee2: nullableString(accounts.additional_fee_2),
      issuanceFee: nullableString(accounts.issuance_fee),
    },
    customerAction: row.customer_action,
    autoSend: row.auto_send,
    autoPoll: row.auto_poll,
    companyMappings,
    maxAttempts: numberValue(row.max_attempts),
    discoveryBatchSize: numberValue(row.discovery_batch_size),
    version: numberValue(row.version),
    updatedAt: iso(row.updated_at),
  }
}

function mapSaleLink(row: SaleLinkRow): WintourSaleLinkSummary {
  return {
    id: row.id,
    companyId: row.company_id,
    emissionId: row.emission_id,
    sourceItemKey: row.source_item_key,
    sourceTicketId: row.source_ticket_id,
    idvExterno: String(row.idv_externo),
    wintourSaleNumber: row.wintour_sale_number === null ? null : String(row.wintour_sale_number),
    state: row.state,
    blockedReasons: stringArray(row.blocked_reasons),
    version: numberValue(row.version),
    updatedAt: iso(row.updated_at),
  }
}

function mapJob(row: JobRow): WintourSyncJobSummary {
  return {
    id: row.id,
    saleLinkId: row.sale_link_id,
    operation: row.operation,
    state: row.state,
    attemptCount: numberValue(row.attempt_count),
    maxAttempts: numberValue(row.max_attempts),
    lastErrorCode: row.last_error_code,
    latestProtocolCode: row.latest_protocol_code || null,
    latestProtocolKind: row.latest_protocol_kind || null,
    downloadAvailable: Boolean(row.payload_bytes),
    version: numberValue(row.version),
    preparedAt: iso(row.prepared_at),
    updatedAt: iso(row.updated_at),
  }
}

function assertVersion(current: number, expected: number): void {
  if (current !== expected) throw versionConflict(expected, current)
}

function versionConflict(expected: number | null, current: number | null): WintourSyncError {
  return new WintourSyncError(
    'WINTOUR_SYNC_VERSION_CONFLICT',
    'O registro Wintour foi alterado por outro processo.',
    409,
    { expectedVersion: expected, currentVersion: current },
  )
}

function notFound(label: string): WintourSyncError {
  return new WintourSyncError(
    'WINTOUR_SYNC_NOT_FOUND',
    `${label} Wintour nao encontrado no tenant autenticado.`,
    404,
  )
}

function validateRedactedPayload(value: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > 16_384) {
    throw new WintourSyncError('WINTOUR_PROTOCOL_PAYLOAD_TOO_LARGE', 'Resumo do protocolo excede 16 KiB.', 400)
  }
  const forbiddenKey = /pin|password|secret|token|credential|authorization|xml|cpf|passport|email|name/i
  const inspect = (candidate: unknown, depth: number): void => {
    if (depth > 5) throw new WintourSyncError('WINTOUR_PROTOCOL_PAYLOAD_INVALID', 'Resumo muito profundo.', 400)
    if (typeof candidate === 'string' && (candidate.length > 2_000 || /<[^>]+>/.test(candidate))) {
      throw new WintourSyncError('WINTOUR_PROTOCOL_PAYLOAD_INVALID', 'Resumo contem conteudo nao redigido.', 400)
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > 100) throw new WintourSyncError('WINTOUR_PROTOCOL_PAYLOAD_INVALID', 'Resumo excessivo.', 400)
      candidate.forEach((item) => inspect(item, depth + 1))
    } else if (candidate && typeof candidate === 'object') {
      for (const [key, item] of Object.entries(candidate)) {
        if (forbiddenKey.test(key)) {
          throw new WintourSyncError('WINTOUR_PROTOCOL_PAYLOAD_SENSITIVE', 'Resumo contem campo sensivel.', 400)
        }
        inspect(item, depth + 1)
      }
    }
  }
  inspect(value, 0)
  return value
}

async function auditInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  event: {
    action: string
    entityType: string
    entityId: string | null
    metadata: Record<string, unknown>
  },
): Promise<void> {
  await writeAuditEventInTransaction(client, {
    ...event,
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.actor?.user.id || principal.user.id,
  })
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item === undefined ? null : item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function iso(value: Date | string): string {
  return new Date(value).toISOString()
}

function numberValue(value: number | string): number {
  return Number(value)
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nullablePayment(value: unknown): WintourSyncSettings['paymentMethodCodes']['faturado'] {
  return typeof value === 'string' && (WINTOUR_PAYMENT_METHODS as readonly string[]).includes(value)
    ? value as WintourSyncSettings['paymentMethodCodes']['faturado']
    : null
}

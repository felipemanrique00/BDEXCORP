import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createWintourSaleAdjustmentInputSchema,
  reconcileWintourSyncJobInputSchema,
  recordWintourSubmissionSuccessInputSchema,
  recordWintourSyncAttemptResultInputSchema,
  recordWintourSyncProtocolInputSchema,
  wintourSyncSettingsInputSchema,
} from '@/lib/wintour-sync'

const service = readFileSync(
  resolve(process.cwd(), 'lib/server/wintour-sync-service.ts'),
  'utf8',
)

const uuid = '11111111-1111-4111-8111-111111111111'

describe('Wintour outbound sync service contracts', () => {
  it('keeps settings strict, credential-free and versioned', () => {
    const base = {
      enabled: true,
      syncFrom: '2026-08-01T00:00:00.000Z',
      agencyName: 'BBT Corporativo',
      branchId: 1,
      branchName: 'Matriz',
      freeField: null,
      productCodes: { air: 'AIR', hotel: null, car: null, bus: null },
      paymentMethodCodes: {
        faturado: 'IV', pix: null, cartao_corporativo: null,
        cartao_agencia: null, transferencia: null, dinheiro: null, outro: null,
      },
      serviceRouteTypes: { air: 1, hotel: null, car: null, bus: null },
      tariffNetDefault: 0,
      accountDefaults: {
        issuer: null, promoter: null, manager: null, supplier: null,
        agencyCostCenter: null, cardCp: null, cardMp: null,
        additionalFee: null, additionalFee2: null, issuanceFee: null,
      },
      customerAction: 'none',
      autoSend: false,
      autoPoll: false,
      companyMappings: [],
      maxAttempts: 3,
      discoveryBatchSize: 100,
      expectedVersion: null,
    }
    expect(wintourSyncSettingsInputSchema.safeParse(base).success).toBe(true)
    expect(wintourSyncSettingsInputSchema.safeParse({ ...base, pin: '1234' }).success).toBe(false)
    expect(wintourSyncSettingsInputSchema.safeParse({
      ...base,
      serviceRouteTypes: { ...base.serviceRouteTypes, bus: 5 },
    }).success).toBe(false)
  })

  it('enforces the DGR-046 adjustment allowlist and remark semantics', () => {
    const base = { saleLinkId: uuid, expectedVersion: 1, reason: 'Correcao validada' }
    expect(createWintourSaleAdjustmentInputSchema.safeParse({
      ...base,
      changes: [{ field: 'info_adcs', content: 'Nova observacao' }],
    }).success).toBe(true)
    expect(createWintourSaleAdjustmentInputSchema.safeParse({
      ...base,
      changes: [{ field: 'info_adcs', content: 'Nova observacao', remark: 'append' }],
    }).success).toBe(true)
    expect(createWintourSaleAdjustmentInputSchema.safeParse({
      ...base,
      changes: [{ field: 'fop', content: 'XX' }],
    }).success).toBe(true)
    expect(createWintourSaleAdjustmentInputSchema.safeParse({
      ...base,
      changes: [{ field: 'fop', content: 'XX', remark: 'xxmanter' }],
    }).success).toBe(true)
    expect(createWintourSaleAdjustmentInputSchema.safeParse({
      ...base,
      changes: [
        { field: 'id_pa', content: '1' },
        { field: 'status', content: 'OK' },
      ],
    }).success).toBe(false)
  })

  it('restricts manual reconciliation to terminal or explicit review outcomes', () => {
    const base = { jobId: uuid, expectedJobVersion: 1, reason: 'Resultado verificado' }
    for (const targetState of ['manual_review', 'completed', 'rejected', 'failed', 'cancelled']) {
      expect(reconcileWintourSyncJobInputSchema.safeParse({ ...base, targetState }).success).toBe(true)
    }
    expect(reconcileWintourSyncJobInputSchema.safeParse({ ...base, targetState: 'received' }).success).toBe(false)
    expect(reconcileWintourSyncJobInputSchema.safeParse({ ...base, targetState: 'processing' }).success).toBe(false)
  })

  it('uses one atomic submission-success command and closes generic submission paths', () => {
    expect(recordWintourSubmissionSuccessInputSchema.safeParse({
      jobId: uuid,
      attemptId: '22222222-2222-4222-8222-222222222222',
      leaseToken: '33333333-3333-4333-8333-333333333333',
      expectedJobVersion: 2,
      expectedAttemptVersion: 1,
      protocolCode: 'PROTO-1',
    }).success).toBe(true)
    expect(recordWintourSyncAttemptResultInputSchema.safeParse({
      jobId: uuid,
      attemptId: '22222222-2222-4222-8222-222222222222',
      leaseToken: '33333333-3333-4333-8333-333333333333',
      expectedJobVersion: 2,
      expectedAttemptVersion: 1,
      state: 'received',
    }).success).toBe(false)
    expect(recordWintourSyncProtocolInputSchema.safeParse({
      jobId: uuid,
      attemptId: '22222222-2222-4222-8222-222222222222',
      expectedJobVersion: 2,
      protocolKind: 'submission',
      protocolCode: 'PROTO-1',
      state: 'received',
    }).success).toBe(false)
    const atomic = service.slice(
      service.indexOf('export async function recordWintourSubmissionSuccess'),
      service.indexOf('export async function claimWintourPollJobs'),
    )
    expect(atomic).toMatch(/update wintour_sync_attempts[\s\S]*state = 'received'/i)
    expect(atomic).toMatch(/insert into wintour_sync_protocols/i)
    expect(atomic).toMatch(/update wintour_sync_jobs[\s\S]*state = 'received'/i)
    expect(atomic).toMatch(/update wintour_sale_links[\s\S]*state = 'received'/i)
  })

  it('claims only ready jobs and quarantines stale source or configuration', () => {
    const claim = service.slice(
      service.indexOf('export async function claimWintourSyncJobs'),
      service.indexOf('export async function recordWintourSyncAttemptResult'),
    )
    expect(claim).toMatch(/job\.state = 'ready'/i)
    expect(claim).not.toMatch(/job\.state = 'sending'[\s\S]*lease_expires_at < now\(\)/i)
    expect(claim).toMatch(/job\.link_source_fingerprint <> link\.source_fingerprint/i)
    expect(claim).toMatch(/emission\.status = 'issued'/i)
    expect(claim).toMatch(/ticket\.status = 'issued'/i)
    expect(claim).toMatch(/air_emission_tickets sibling[\s\S]*sibling\.status <> 'issued'/i)
    expect(claim).toMatch(/air_reservation_segments segment[\s\S]*segment\.status <> 'issued'/i)
    expect(claim).toMatch(/join air_demand_details detail/i)
    expect(claim).toMatch(/wintour_sale_source_freshness_at\([\s\S]*> link\.source_refreshed_at/i)
    expect(claim).toMatch(/wintour_sale_source_freshness_at\([\s\S]*<= link\.source_refreshed_at/i)
    expect(claim).toMatch(/or not exists \([\s\S]*join air_reservation_segments segment/i)
    expect(claim).toMatch(/source_changed_or_ineligible_after_prepare/i)
    expect(claim).toMatch(/candidate\.config_fingerprint !== currentConfigFingerprint/i)
    expect(claim).toMatch(/configuration_changed_after_prepare/i)
    expect(claim).toMatch(/payloadSha256:[\s\S]*transportFreeField:[\s\S]*serializerVersion:/i)
    expect(claim).toMatch(/await lockCanonicalEmissionTables\(client\)[\s\S]*with stale as/i)
    expect(claim.indexOf('await lockCanonicalEmissionTables(client)')).toBeLessThan(
      claim.indexOf('requireEnabledSettings(client, principal.tenantId)'),
    )
    expect(claim).toMatch(/const settings = await requireEnabledSettings[\s\S]*if \(!settings\.auto_send\) return \[\]/i)
    expect(claim).toMatch(/Math\.min\(values\.limit, 1\)/i)
    const locks = service.slice(
      service.indexOf('async function lockCanonicalEmissionTables'),
      service.indexOf('async function lockCanonicalEmissionFacts'),
    )
    expect(locks).toMatch(/lock table[\s\S]*air_emission_tickets[\s\S]*geo_airports[\s\S]*integration_actor_mappings[\s\S]*wintour_sync_settings[\s\S]*in exclusive mode nowait/i)
    const factLocks = service.slice(
      service.indexOf('async function lockCanonicalEmissionFacts'),
      service.indexOf('async function loadCanonicalEmissionCandidate'),
    )
    for (const table of [
      'travel_emissions', 'reservations', 'demands', 'requesters', 'cost_centers',
      'air_emission_tickets', 'demand_travelers', 'employees',
      'air_reservation_details', 'air_demand_details', 'air_reservation_segments',
      'geo_airports', 'integration_company_mappings', 'integration_actor_mappings',
    ]) expect(factLocks).toContain(table)
    expect(factLocks).toMatch(/for share(?: of emission, reservation, demand)? nowait/i)
    expect(factLocks).not.toMatch(/count\([^)]*\)[\s\S]{0,200}for share/i)
    expect(claim).toMatch(/job\.operation = 'update'[\s\S]*or \([\s\S]*emission\.status = 'issued'/i)
    expect(claim).toMatch(/candidate\.operation === 'create'[\s\S]*buildCanonicalSale/i)
  })

  it('discovers a canonical relational air subset without provider payloads or truncation', () => {
    const discover = service.slice(
      service.indexOf('export async function discoverWintourSyncSales'),
      service.indexOf('export async function prepareWintourSyncJob'),
    )
    expect(discover).toMatch(/join demands demand/i)
    expect(discover).toMatch(/left join air_emission_tickets ticket/i)
    expect(discover).not.toMatch(/reservation\.service_type = 'aereo' and ticket\.status = 'issued'/i)
    expect(discover).toMatch(/left join air_reservation_details air/i)
    expect(discover).toMatch(/from air_reservation_segments segment/i)
    expect(discover).toMatch(/emission\.issued_at >= \$3::timestamptz/i)
    expect(discover).toMatch(/lower\(emission\.provider\) <> \$2/i)
    expect(discover).not.toMatch(/provider_payload/i)
    expect(service).toMatch(/candidate\.provider !== 'manual-offline'/i)
    expect(service).toMatch(/ticketNumber\.length !== 10/i)
    expect(service).toMatch(/air_ticket_number_invalid_length/i)
    expect(service).toMatch(/air_ticket_amount_allocation_missing/i)
    expect(service).toMatch(/emission_status_not_exportable/i)
    expect(service).toMatch(/air_ticket_status_not_issued/i)
    expect(service).toMatch(/air_emission_contains_non_issued_ticket/i)
    expect(service).toMatch(/air_ticket_amount_allocation_inconsistent/i)
    expect(service).toMatch(/air_traveler_name_mismatch/i)
    expect(service).toMatch(/air_provider_ambiguous_across_segments/i)
    expect(service).toMatch(/air_provider_mismatch_with_segments/i)
    expect(service).toMatch(/segmentAirlines\.has\(issuingAirlineCode\)/i)
    expect(service).toMatch(/air_airport_timezone_missing_or_ambiguous/i)
    expect(service).toMatch(/candidate\.status !== 'issued'/i)
    expect(service).toMatch(/ticket\.issued_at as ticket_issued_at/i)
    const sourceFingerprint = service.slice(
      service.indexOf('function emissionSourceFingerprint'),
      service.indexOf('function boundedText'),
    )
    for (const fact of [
      'createdAt', 'updatedAt', 'serviceType', 'issuingAirlineCode', 'issuingAirlineName',
      'employeeDepartment', 'employeeRegistrationCode', 'ticketCount',
      'ticketsFareTotalMinor', 'ticketsTaxTotalMinor', 'ticketsTotalMinor',
    ]) expect(sourceFingerprint).toContain(fact)
  })

  it('accepts only the legacy zero sentinel or exact amounts for a single air ticket', () => {
    expect(service).toMatch(/usesOfflineSentinel = ticketFare === 0 && ticketTax === 0 && ticketTotal === 0/i)
    expect(service).toMatch(/ticketFare !== grossMinor \|\| ticketTax !== taxMinor \|\| ticketTotal !== totalMinor/i)
    expect(service).toMatch(/count\(\*\) filter \(where item\.status <> 'issued'\)/i)
  })

  it('fails closed when customer synchronization is configured without customer data', () => {
    const artifact = service.slice(
      service.indexOf('function buildPreparedArtifact'),
      service.indexOf('function wintourDate'),
    )
    expect(artifact).toMatch(/input\.settings\.customer_action !== 'none'/i)
    expect(artifact).toMatch(/customer_data_mapping_unsupported/i)
  })

  it('uses registration and issuance dates distinctly and only emits card accounts for matching FOPs', () => {
    expect(service).toMatch(/emission\.created_at as emission_created_at/i)
    expect(service).toMatch(/dt_interna_cadastro: wintourDate\(emissionCreatedAt,/i)
    expect(service).toMatch(/data_lancamento: wintourDate\(ticketIssuedAt,/i)
    const artifact = service.slice(
      service.indexOf('function buildPreparedArtifact'),
      service.indexOf('function wintourDate'),
    )
    expect(artifact).toMatch(/WINTOUR_CP_ACCOUNT_METHODS\.has\(paymentMethod\)/i)
    expect(artifact).toMatch(/WINTOUR_MP_ACCOUNT_METHODS\.has\(paymentMethod\)/i)
  })

  it('drains new and refreshed emissions across bounded discovery cycles', () => {
    expect(service).toMatch(/order by \(discovered_link\.id is null\) desc/i)
    expect(service).toMatch(/max\(origin_airport\.max_updated_at\)/i)
    expect(service).toMatch(/max\(destination_airport\.max_updated_at\)/i)
    expect(service).toMatch(/max\(airport\.updated_at\) as max_updated_at/i)
    expect(service).toMatch(/wintour_sale_source_freshness_at\(/i)
    expect(service).toMatch(/discovered_link\.source_refreshed_at/i)
    expect(service).toMatch(/source_refresh_needed desc/i)
    expect(service).toMatch(/set source_refreshed_at = \$[47]::timestamptz/i)
    expect(service).not.toMatch(/coalesce\(discovered_link\.updated_at, '-infinity'::timestamptz\)/i)
  })

  it('drains preparation pages without rescanning links that already have an active create job', () => {
    const prepareReady = service.slice(
      service.indexOf('export async function prepareReadyWintourSyncJobs'),
      service.indexOf('export async function bindWintourSaleNumber'),
    )
    expect(prepareReady).toMatch(/and not exists \([\s\S]*from wintour_sync_jobs job/i)
    expect(prepareReady).toMatch(/job\.state in \([\s\S]*'ready'[\s\S]*'manual_review'/i)
    expect(prepareReady).not.toMatch(/job\.source_fingerprint = link\.source_fingerprint/i)
  })

  it('does not append an audit event for a no-op discovery cycle', () => {
    expect(service).toMatch(/if \(result\.created > 0 \|\| result\.refreshed > 0\) \{[\s\S]*integration\.wintour_sync\.discover/i)
  })

  it('turns XML validation and ISO-8859-1 failures into a per-link blocker', () => {
    expect(service).toMatch(/error instanceof WintourXmlValidationError/i)
    expect(service).toMatch(/WINTOUR_ARTIFACT_XML_INVALID/i)
    expect(service).toMatch(/artifact_xml_validation_failed/i)
    const prepareReady = service.slice(
      service.indexOf('export async function prepareReadyWintourSyncJobs'),
      service.indexOf('export async function bindWintourSaleNumber'),
    )
    expect(prepareReady).toMatch(/WINTOUR_ARTIFACT_XML_INVALID/i)
  })

  it('applies corporate scope and reports capabilities from DB and server gates', () => {
    expect(service).toMatch(/\$5::text\[\] is null or company_id = any\(\$5::text\[\]\)/i)
    expect(service).toMatch(/values\.companyIds\.filter\(\(id\) => scope\.includes\(id\)\)/i)
    expect(service).toMatch(/WINTOUR_SYNC_ENABLED/i)
    expect(service).toMatch(/WINTOUR_AUTO_SEND/i)
    expect(service).toMatch(/WINTOUR_PROTOCOL_POLL_ENABLED/i)
    expect(service).toMatch(/environment\.WINTOUR_TENANT_ID === principal\.tenantId/i)
    expect(service).toMatch(/WINTOUR_PIN\?\.trim\(\)/i)
    expect(service).not.toMatch(/permissoes\?\.importar_planilhas/i)
    const scope = service.slice(
      service.indexOf('function companyScope'),
      service.indexOf('function assertCompanyAccess'),
    )
    expect(scope).toMatch(/principal\.corporateAccess[\s\S]*\.filter\(\(company\) => company\.permissions\.gerenciar_integracoes\)[\s\S]*\.map\(\(company\) => company\.companyId\)/i)
    expect(scope).not.toMatch(/corporateAccess\?\.companyIds/i)
    expect(scope).toMatch(/: principal\.user\.permissoes\?\.gerenciar_integracoes[\s\S]*principal\.user\.company_id/i)
    const artifact = service.slice(
      service.indexOf('export async function getWintourSyncJobArtifact'),
      service.indexOf('export async function discoverWintourSyncSales'),
    )
    expect(artifact).toMatch(/assertCompanyAccess\(principal, job\.company_id\)/i)
  })

  it('keeps external outcomes on jobs while preserving a source-change alert on the sale link', () => {
    const recovery = service.slice(
      service.indexOf('export async function recoverStaleWintourSyncJobs'),
      service.indexOf('export async function retryWintourSyncJob'),
    )
    expect(recovery).toMatch(/update wintour_sync_jobs[\s\S]*state = 'ambiguous'/i)
    expect(recovery).toMatch(/update wintour_sale_links[\s\S]*state = 'sending'[\s\S]*source_fingerprint = \$5/i)
    expect(recovery).not.toMatch(/A venda mudou durante a recuperacao do lease/i)

    const attempt = service.slice(
      service.indexOf('export async function recordWintourSyncAttemptResult'),
      service.indexOf('export async function recordWintourSubmissionSuccess'),
    )
    expect(attempt).not.toMatch(/row\.job_state !== 'sending' \|\| row\.link_state !== 'sending'/i)
    expect(attempt).toMatch(/update wintour_sale_links[\s\S]*state = 'sending'[\s\S]*source_fingerprint = \$6/i)

    const submission = service.slice(
      service.indexOf('export async function recordWintourSubmissionSuccess'),
      service.indexOf('export async function claimWintourPollJobs'),
    )
    expect(submission).toMatch(/insert into wintour_sync_protocols/i)
    expect(submission).not.toMatch(/job\.state !== 'sending' \|\| job\.link_state !== 'sending'/i)
    expect(submission).toMatch(/update wintour_sale_links[\s\S]*state = 'sending'[\s\S]*source_fingerprint = \$5/i)
    expect(submission).not.toMatch(/if \(!linkUpdate\.rows\[0\]\)/i)

    const reconcile = service.slice(
      service.indexOf('export async function reconcileWintourSyncJob'),
      service.indexOf('export async function claimWintourSyncJobs'),
    )
    expect(reconcile).toMatch(/update wintour_sync_jobs[\s\S]*update wintour_sale_links/i)
    expect(reconcile).toMatch(/set state = case when source_fingerprint = \$7 then \$3 else state end/i)
    expect(reconcile).not.toMatch(/if \(!linkUpdated\.rows\[0\]\)/i)

    const polling = service.slice(
      service.indexOf('export async function claimWintourPollJobs'),
      service.indexOf('export async function recordWintourSyncProtocol'),
    )
    expect(polling).toMatch(/WINTOUR_SOURCE_CHANGED_AFTER_SUBMISSION/i)
    expect(polling).toMatch(/job\.poll_lease_token is null or job\.poll_lease_expires_at <= now\(\)/i)
    expect(polling).toMatch(/job\.link_source_fingerprint = link\.source_fingerprint/i)
    expect(polling).toMatch(/link\.state in \('received', 'processing'\)/i)
    expect(polling).toMatch(/set state = case[\s\S]*source_fingerprint = \$7[\s\S]*else state/i)
  })

  it('bounds paid protocol polling independently from submission attempts', () => {
    const polling = service.slice(
      service.indexOf('export async function claimWintourPollJobs'),
      service.indexOf('export async function recordWintourPollResult'),
    )
    expect(service).toMatch(/WINTOUR_MAX_POLL_ATTEMPTS = 12/i)
    expect(service).toMatch(/WINTOUR_MAX_POLL_WINDOW_HOURS = 24/i)
    expect(polling).toMatch(/poll_limit_exhausted/i)
    expect(polling).toMatch(/job\.poll_attempt_count >= \$3/i)
    expect(polling).toMatch(/poll_attempt_count = poll_attempt_count \+ 1/i)
    expect(polling).toMatch(/poll_started_at = coalesce\(poll_started_at, now\(\)\)/i)
  })

  it('counts the effective latest sale state with link review taking precedence', () => {
    const dashboard = service.slice(
      service.indexOf('export async function getWintourSyncDashboard'),
      service.indexOf('export async function updateWintourSyncSettings'),
    )
    expect(dashboard).toMatch(/select distinct on \(job\.sale_link_id\)/i)
    expect(dashboard).toMatch(/when link\.state in \('blocked', 'manual_review'\) then link\.state/i)
    expect(dashboard).toMatch(/when jsonb_array_length\(link\.blocked_reasons\) > 0 then 'manual_review'/i)
    expect(dashboard).toMatch(/coalesce\(latest_job\.state, link\.state\)/i)
  })

  it('validates artifact identifiers before passing them to PostgreSQL', () => {
    expect(service).toMatch(/\^\[0-9a-f\]\{8\}\(\?:-\[0-9a-f\]\{4\}\)\{3\}-\[0-9a-f\]\{12\}\$/i)
  })

  it('canonicalizes values with the same undefined semantics as JSONB persistence', () => {
    const canonical = service.slice(
      service.indexOf('function canonical(value: unknown)'),
      service.indexOf('function iso('),
    )
    expect(canonical).toMatch(/if \(value === undefined\) return 'null'/i)
    expect(canonical).toMatch(/item === undefined \? null : item/i)
    expect(canonical).toMatch(/\.filter\(\(key\) => record\[key\] !== undefined\)/i)
  })
})

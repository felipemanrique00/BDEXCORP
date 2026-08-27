import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0084_wintour_outbound_sync.sql'),
  'utf8',
)

describe('Wintour outbound sync migration', () => {
  it('creates the five tenant-owned outbound tables under forced RLS', () => {
    for (const table of [
      'wintour_sync_settings',
      'wintour_sale_links',
      'wintour_sync_jobs',
      'wintour_sync_attempts',
      'wintour_sync_protocols',
    ]) {
      expect(migration).toMatch(new RegExp(`create table if not exists ${table}`, 'i'))
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toMatch(/alter table %I force row level security/i)
    expect(migration).toMatch(/create policy tenant_isolation on %I/i)
  })

  it('keeps credentials out of tenant settings and constrains the configuration envelope', () => {
    const settings = migration.slice(
      migration.indexOf('create table if not exists wintour_sync_settings'),
      migration.indexOf('create table if not exists wintour_sale_links'),
    )
    expect(settings).not.toMatch(/\b(?:pin|password|secret|credential)\b/i)
    expect(settings).toMatch(/agency_name text not null/i)
    expect(settings).toMatch(/product_codes jsonb not null/i)
    expect(settings).toMatch(/payment_method_codes jsonb not null/i)
    expect(settings).toMatch(/service_route_types jsonb not null/i)
    expect(settings).toMatch(/customer_action in \('none', 'I', 'U', 'IU'\)/i)
  })

  it('models one stable external identity per emission item, including air tickets', () => {
    const links = migration.slice(
      migration.indexOf('create table if not exists wintour_sale_links'),
      migration.indexOf('create table if not exists wintour_sync_jobs'),
    )
    expect(migration).toMatch(/unique \(tenant_id, emission_id, source_item_key\)/i)
    expect(migration).toMatch(/idv_externo between 1 and 9999999999/i)
    expect(migration).toMatch(/source_item_key = 'air-ticket:' \|\| source_ticket_id::text/i)
    expect(migration).toMatch(/source_ticket_id is null and source_item_key = 'emission'/i)
    expect(migration).toMatch(/references air_emission_tickets\(tenant_id, id\)/i)
    expect(links).toMatch(/source_refreshed_at timestamptz not null default now\(\)/i)
    expect(links).toMatch(/wintour_sale_links_source_refresh_idx/i)
  })

  it('separates relational, configuration and request fingerprints', () => {
    expect(migration).toMatch(/link_source_fingerprint char\(64\) not null/i)
    expect(migration).toMatch(/config_fingerprint char\(64\) not null/i)
    expect(migration).toMatch(/source_fingerprint char\(64\) not null/i)
    expect(migration).toMatch(/request_fingerprint char\(64\) not null/i)
    expect(migration).toMatch(/link_fingerprint <> new\.link_source_fingerprint/i)
  })

  it('centralizes the live canonical source freshness watermark under tenant RLS', () => {
    const freshness = migration.slice(
      migration.indexOf('create or replace function wintour_sale_source_freshness_at'),
      migration.indexOf('create or replace function validate_wintour_sale_link_scope'),
    )
    expect(freshness).toMatch(/security invoker/i)
    expect(freshness).toMatch(/requesters requester/i)
    expect(freshness).toMatch(/cost_centers cost_center/i)
    expect(freshness).toMatch(/demand_travelers traveler/i)
    expect(freshness).toMatch(/employees employee/i)
    expect(freshness).toMatch(/air_reservation_details air/i)
    expect(freshness).toMatch(/air_demand_details air_demand/i)
    expect(freshness).toMatch(/air_emission_tickets item/i)
    expect(freshness).toMatch(/air_reservation_segments segment/i)
    expect(freshness).toMatch(/geo_airports airport/i)
    expect(freshness).toMatch(/integration_company_mappings mapping/i)
    expect(freshness).toMatch(/integration_actor_mappings mapping/i)
    expect(freshness).toMatch(/wintour_sync_settings settings/i)
    expect(freshness).toMatch(/where upper\(airport\.iata_code::text\) = segment\.origin_code/i)
    expect(freshness).not.toMatch(/airport\.is_active/i)
    expect(freshness).not.toMatch(/security definer/i)
  })

  it('persists one immutable exact XML artifact with captured transport context', () => {
    expect(migration).toMatch(/file_number.*between 1 and 2147483647/i)
    expect(migration).toMatch(/payload_bytes bytea/i)
    expect(migration).toMatch(/payload_sha256 char\(64\)/i)
    expect(migration).toContain("payload_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}[.]xml$'")
    expect(migration).not.toContain("{0,199}\\\\.xml$'")
    expect(migration).toMatch(/payload_content_type is null or payload_content_type = 'application\/xml'/i)
    expect(migration).toMatch(/serializer_version text/i)
    expect(migration).toMatch(/transport_free_field text/i)
    expect(migration).toMatch(/Artefato XML Wintour ja anexado e imutavel/i)
  })

  it('enforces send and poll leases without making stale sends claimable', () => {
    expect(migration).toMatch(/\(state = 'sending'\) = \(lease_token is not null and lease_expires_at is not null\)/i)
    expect(migration).toMatch(/poll_lease_token is null or state in \('received', 'processing'\)/i)
    expect(migration).toMatch(/poll_attempt_count integer not null default 0/i)
    expect(migration).toMatch(/poll_attempt_count between 0 and 12/i)
    expect(migration).toMatch(/poll_started_at timestamptz/i)
    expect(migration).toMatch(/when 'completed' then[\s\S]*terminal/i)
    expect(migration).toMatch(/when 'received' then next_state in \([\s\S]*'cancelled'/i)
    expect(migration).toMatch(/when 'processing' then next_state in \([\s\S]*'cancelled'/i)
    expect(migration).toMatch(/Job Wintour concluido e terminal/i)
  })

  it('keeps protocols append-only through the service while preserving tenant reset cascades', () => {
    expect(migration).toMatch(/create or replace function preserve_wintour_protocol\(\)/i)
    expect(migration).toMatch(/before update on wintour_sync_protocols/i)
    expect(migration).toMatch(/references wintour_sync_jobs\(tenant_id, id\) on delete cascade/i)
    expect(migration).toMatch(/unique \(tenant_id, observation_key\)/i)
  })

  it('is additive and contains no destructive table operation', () => {
    expect(migration).not.toMatch(/\b(?:drop\s+table|drop\s+column|truncate\s+table)\b/i)
  })
})

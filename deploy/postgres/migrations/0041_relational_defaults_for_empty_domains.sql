begin;

with domain_sources(domain_key, source_keys) as (
  values
    ('approvals'::text, array['bbt-aprovacoes']::text[]),
    ('demands', array['bbt-atendimentos']::text[]),
    ('emissions', array['bbt-emissoes']::text[]),
    ('finance', array['bbt-financeiro', 'bbt-corporate-finance']::text[]),
    ('requesters', array['bbt-solicitantes-empresa']::text[]),
    ('vouchers', array['bbt-vouchers-emitidos', 'bbt-vouchers-last-numero']::text[])
)
update tenant_domain_rollouts rollout
set read_mode = 'relational',
    write_mode = 'relational',
    metadata = rollout.metadata || jsonb_build_object(
      'automaticCutover', false,
      'source', 'migration-0041',
      'legacyDataPresent', false,
      'relationalDefaultAt', now()
    ),
    version = rollout.version + 1
from domain_sources source
where rollout.domain_key = source.domain_key
  and rollout.status = 'active'
  and not exists (
    select 1
    from app_kv legacy
    where legacy.tenant_id = rollout.tenant_id
      and legacy.key = any(source.source_keys)
      and legacy.value not in (
        'null'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        '""'::jsonb
      )
  );

commit;

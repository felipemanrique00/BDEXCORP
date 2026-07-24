begin;

insert into tenant_domain_rollouts (
  tenant_id,
  domain_key,
  read_mode,
  write_mode,
  status,
  metadata
)
select
  tenant.id,
  domain.domain_key,
  'shadow',
  'dual',
  'active',
  jsonb_build_object(
    'source', 'migration-0039',
    'automaticCutover', false
  )
from tenants tenant
cross join (
  values
    ('approvals'),
    ('demands'),
    ('emissions'),
    ('finance'),
    ('requesters'),
    ('vouchers')
) as domain(domain_key)
on conflict (tenant_id, domain_key) do nothing;

commit;

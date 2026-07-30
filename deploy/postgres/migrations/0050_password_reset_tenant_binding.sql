alter table password_reset_tokens
  add column if not exists tenant_id uuid;

with reset_tenants as (
  select reset_row.id,
         min(membership.tenant_id::text)::uuid as tenant_id
    from password_reset_tokens reset_row
    join tenant_memberships membership
      on membership.user_id = reset_row.user_id
     and membership.status = 'active'
    join tenants tenant_row
      on tenant_row.id = membership.tenant_id
     and tenant_row.status in ('active', 'trial')
   where reset_row.tenant_id is null
   group by reset_row.id
)
update password_reset_tokens reset_row
   set tenant_id = reset_tenants.tenant_id
  from reset_tenants
 where reset_row.id = reset_tenants.id;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'password_reset_tokens_tenant_fk'
       and conrelid = 'password_reset_tokens'::regclass
  ) then
    alter table password_reset_tokens
      add constraint password_reset_tokens_tenant_fk
      foreign key (tenant_id) references tenants(id) on delete set null;
  end if;
end;
$$;

create index if not exists password_reset_tokens_tenant_user_idx
  on password_reset_tokens (tenant_id, user_id, created_at desc);

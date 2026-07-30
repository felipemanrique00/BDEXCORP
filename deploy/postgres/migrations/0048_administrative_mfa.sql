begin;

alter table user_sessions
  add column if not exists authentication_level text not null default 'password'
    check (authentication_level in ('password', 'mfa')),
  add column if not exists mfa_verified_at timestamptz,
  add column if not exists mfa_method text
    check (mfa_method is null or mfa_method in ('totp', 'recovery_code'));

create table if not exists user_mfa_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null references tenant_memberships(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  method text not null default 'totp' check (method = 'totp'),
  status text not null default 'pending'
    check (status in ('pending', 'enabled', 'disabled')),
  secret_ciphertext text not null,
  secret_iv text not null,
  secret_auth_tag text not null,
  last_used_step bigint,
  enabled_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, membership_id, method),
  unique (tenant_id, id),
  check (
    (status = 'pending' and enabled_at is null and disabled_at is null)
    or (status = 'enabled' and enabled_at is not null and disabled_at is null)
    or (status = 'disabled' and disabled_at is not null)
  )
);

create index if not exists user_mfa_methods_user_idx
  on user_mfa_methods (tenant_id, user_id, status);

create table if not exists user_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  mfa_method_id uuid not null,
  membership_id uuid not null references tenant_memberships(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  code_hash char(64) not null check (code_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, mfa_method_id)
    references user_mfa_methods(tenant_id, id) on delete cascade,
  unique (tenant_id, user_id, code_hash)
);

create index if not exists user_mfa_recovery_codes_available_idx
  on user_mfa_recovery_codes (tenant_id, user_id, created_at desc)
  where used_at is null;

create table if not exists auth_mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null references tenant_memberships(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  token_hash char(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  purpose text not null check (purpose in ('login', 'enrollment')),
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'expired', 'locked')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null check (max_attempts between 3 and 10),
  expires_at timestamptz not null,
  verified_at timestamptz,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  check (attempts <= max_attempts),
  check (
    (status = 'consumed' and verified_at is not null)
    or (status <> 'consumed' and verified_at is null)
  )
);

create index if not exists auth_mfa_challenges_pending_idx
  on auth_mfa_challenges (tenant_id, user_id, status, expires_at desc);

create or replace function validate_mfa_membership_identity()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from tenant_memberships
    where id = new.membership_id
      and tenant_id = new.tenant_id
      and user_id = new.user_id
  ) then
    raise exception 'Vinculo MFA nao pertence ao usuario e tenant informados.';
  end if;
  return new;
end;
$$;

create or replace function validate_mfa_recovery_identity()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from user_mfa_methods
    where id = new.mfa_method_id
      and tenant_id = new.tenant_id
      and membership_id = new.membership_id
      and user_id = new.user_id
  ) then
    raise exception 'Codigo de recuperacao nao pertence ao metodo MFA informado.';
  end if;
  return new;
end;
$$;

drop trigger if exists user_mfa_methods_validate_identity on user_mfa_methods;
create trigger user_mfa_methods_validate_identity
before insert or update of tenant_id, membership_id, user_id
on user_mfa_methods
for each row execute function validate_mfa_membership_identity();

drop trigger if exists auth_mfa_challenges_validate_identity on auth_mfa_challenges;
create trigger auth_mfa_challenges_validate_identity
before insert or update of tenant_id, membership_id, user_id
on auth_mfa_challenges
for each row execute function validate_mfa_membership_identity();

drop trigger if exists user_mfa_recovery_codes_validate_identity
  on user_mfa_recovery_codes;
create trigger user_mfa_recovery_codes_validate_identity
before insert or update of tenant_id, mfa_method_id, membership_id, user_id
on user_mfa_recovery_codes
for each row execute function validate_mfa_recovery_identity();

drop trigger if exists user_mfa_methods_set_updated_at on user_mfa_methods;
create trigger user_mfa_methods_set_updated_at
before update on user_mfa_methods
for each row execute function set_updated_at();

select tenant_rls_policy('user_mfa_methods');
select tenant_rls_policy('user_mfa_recovery_codes');
select tenant_rls_policy('auth_mfa_challenges');

commit;

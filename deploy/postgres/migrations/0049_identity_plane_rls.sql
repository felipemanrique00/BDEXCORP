create or replace function app_context_uuid(setting_name text)
returns uuid
language plpgsql
stable
as $$
declare
  raw_value text;
begin
  raw_value := current_setting(setting_name, true);
  if raw_value is null or raw_value = '' then
    return null;
  end if;
  begin
    return raw_value::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

create or replace function app_context_text(setting_name text)
returns text
language sql
stable
as $$
  select nullif(current_setting(setting_name, true), '');
$$;

create or replace function app_context_is_platform_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from users
     where id = app_context_uuid('app.platform_admin_user_id')
       and platform_admin = true
       and status = 'active'
       and deleted_at is null
  );
$$;

alter table tenant_memberships enable row level security;
alter table tenant_memberships force row level security;
drop policy if exists tenant_isolation on tenant_memberships;
drop policy if exists identity_scope on tenant_memberships;
create policy identity_scope on tenant_memberships
using (
  tenant_id = app_context_uuid('app.tenant_id')
  or user_id = app_context_uuid('app.identity_user_id')
  or app_context_is_platform_admin()
  or exists (
    select 1
      from user_sessions session_row
     where session_row.membership_id = tenant_memberships.id
       and session_row.token_hash = app_context_text('app.session_token_hash')
  )
)
with check (
  tenant_id = app_context_uuid('app.tenant_id')
  or app_context_is_platform_admin()
);

alter table roles enable row level security;
alter table roles force row level security;
drop policy if exists tenant_isolation on roles;
drop policy if exists identity_scope on roles;
create policy identity_scope on roles
using (
  tenant_id is null
  or tenant_id = app_context_uuid('app.tenant_id')
  or app_context_is_platform_admin()
  or exists (
    select 1
      from tenant_memberships membership
     where membership.role_id = roles.id
       and (
         membership.user_id = app_context_uuid('app.identity_user_id')
         or exists (
           select 1
             from user_sessions session_row
            where session_row.membership_id = membership.id
              and session_row.token_hash = app_context_text('app.session_token_hash')
         )
       )
  )
)
with check (
  (tenant_id is not null and tenant_id = app_context_uuid('app.tenant_id'))
  or app_context_is_platform_admin()
);

alter table tenant_subscriptions enable row level security;
alter table tenant_subscriptions force row level security;
drop policy if exists tenant_isolation on tenant_subscriptions;
drop policy if exists identity_scope on tenant_subscriptions;
create policy identity_scope on tenant_subscriptions
using (
  tenant_id = app_context_uuid('app.tenant_id')
  or app_context_is_platform_admin()
  or exists (
    select 1
      from tenant_memberships membership
     where membership.tenant_id = tenant_subscriptions.tenant_id
       and (
         membership.user_id = app_context_uuid('app.identity_user_id')
         or exists (
           select 1
             from user_sessions session_row
            where session_row.membership_id = membership.id
              and session_row.token_hash = app_context_text('app.session_token_hash')
         )
       )
  )
)
with check (
  tenant_id = app_context_uuid('app.tenant_id')
  or app_context_is_platform_admin()
);

alter table user_invites enable row level security;
alter table user_invites force row level security;
drop policy if exists tenant_isolation on user_invites;
drop policy if exists identity_scope on user_invites;
create policy identity_scope on user_invites
using (
  tenant_id = app_context_uuid('app.tenant_id')
  or user_id = app_context_uuid('app.identity_user_id')
  or token_hash = app_context_text('app.invite_token_hash')
  or app_context_is_platform_admin()
)
with check (
  tenant_id = app_context_uuid('app.tenant_id')
  or token_hash = app_context_text('app.invite_token_hash')
  or app_context_is_platform_admin()
);

alter table user_sessions enable row level security;
alter table user_sessions force row level security;
drop policy if exists tenant_isolation on user_sessions;
drop policy if exists identity_scope on user_sessions;
create policy identity_scope on user_sessions
using (
  tenant_id = app_context_uuid('app.tenant_id')
  or user_id = app_context_uuid('app.identity_user_id')
  or token_hash = app_context_text('app.session_token_hash')
  or app_context_is_platform_admin()
)
with check (
  tenant_id = app_context_uuid('app.tenant_id')
  or user_id = app_context_uuid('app.identity_user_id')
  or token_hash = app_context_text('app.session_token_hash')
  or app_context_is_platform_admin()
);

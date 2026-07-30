begin;

alter table assistant_conversations
  add column if not exists owner_user_id uuid references users(id) on delete cascade;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assistant_conversations_owner_membership_fk'
      and conrelid = 'assistant_conversations'::regclass
  ) then
    alter table assistant_conversations
      add constraint assistant_conversations_owner_membership_fk
      foreign key (tenant_id, owner_user_id)
      references tenant_memberships(tenant_id, user_id)
      on delete cascade;
  end if;
end;
$$;

create index if not exists assistant_conversations_owner_last_message_idx
  on assistant_conversations (tenant_id, owner_user_id, last_message_at desc)
  where owner_user_id is not null;

commit;

begin;

alter table policy_templates
  add column if not exists checkpoints text[] not null default array['*']::text[];

alter table policy_versions
  add column if not exists checkpoints text[] not null default array['*']::text[];

alter table policy_templates
  drop constraint if exists policy_templates_checkpoints_valid;
alter table policy_templates
  add constraint policy_templates_checkpoints_valid check (
    cardinality(checkpoints) between 1 and 50
    and array_position(checkpoints, '') is null
    and array_to_string(checkpoints, ',') ~ '^(\*|[a-z][a-z0-9_]*)(,(\*|[a-z][a-z0-9_]*))*$'
    and (not ('*' = any(checkpoints)) or cardinality(checkpoints) = 1)
  );

alter table policy_versions
  drop constraint if exists policy_versions_checkpoints_valid;
alter table policy_versions
  add constraint policy_versions_checkpoints_valid check (
    cardinality(checkpoints) between 1 and 50
    and array_position(checkpoints, '') is null
    and array_to_string(checkpoints, ',') ~ '^(\*|[a-z][a-z0-9_]*)(,(\*|[a-z][a-z0-9_]*))*$'
    and (not ('*' = any(checkpoints)) or cardinality(checkpoints) = 1)
  );

create index if not exists policy_versions_checkpoints_idx
  on policy_versions using gin (checkpoints);

commit;

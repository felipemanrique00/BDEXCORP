begin;

-- demand_travelers é compartilhada entre hotelaria e aéreo. Os campos
-- abaixo mantêm a identidade usada no momento da solicitação/emissão sem
-- depender de alterações futuras no cadastro corporativo do funcionário.
alter table demand_travelers
  add column if not exists first_name_snapshot text,
  add column if not exists last_name_snapshot text,
  add column if not exists document_number_snapshot text,
  add column if not exists birth_date_snapshot date,
  add column if not exists traveler_sequence smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'demand_travelers_first_name_snapshot_not_blank'
      and conrelid = 'demand_travelers'::regclass
  ) then
    alter table demand_travelers
      add constraint demand_travelers_first_name_snapshot_not_blank
      check (first_name_snapshot is null or btrim(first_name_snapshot) <> '') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'demand_travelers_last_name_snapshot_not_blank'
      and conrelid = 'demand_travelers'::regclass
  ) then
    alter table demand_travelers
      add constraint demand_travelers_last_name_snapshot_not_blank
      check (last_name_snapshot is null or btrim(last_name_snapshot) <> '') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'demand_travelers_document_snapshot_not_blank'
      and conrelid = 'demand_travelers'::regclass
  ) then
    alter table demand_travelers
      add constraint demand_travelers_document_snapshot_not_blank
      check (document_number_snapshot is null or btrim(document_number_snapshot) <> '') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'demand_travelers_sequence_positive'
      and conrelid = 'demand_travelers'::regclass
  ) then
    alter table demand_travelers
      add constraint demand_travelers_sequence_positive
      check (traveler_sequence is null or traveler_sequence > 0) not valid;
  end if;
end;
$$;

alter table demand_travelers
  validate constraint demand_travelers_first_name_snapshot_not_blank;
alter table demand_travelers
  validate constraint demand_travelers_last_name_snapshot_not_blank;
alter table demand_travelers
  validate constraint demand_travelers_document_snapshot_not_blank;
alter table demand_travelers
  validate constraint demand_travelers_sequence_positive;

create index if not exists demand_travelers_demand_active_idx
  on demand_travelers (
    tenant_id, demand_id, is_primary desc,
    traveler_sequence nulls last, created_at, id
  )
  where deleted_at is null;

create unique index if not exists demand_travelers_active_sequence_uidx
  on demand_travelers (tenant_id, demand_id, traveler_sequence)
  where deleted_at is null and traveler_sequence is not null;

comment on column demand_travelers.first_name_snapshot is
  'Primeiro nome canônico usado no PNR no momento da demanda.';
comment on column demand_travelers.last_name_snapshot is
  'Sobrenome canônico usado no PNR no momento da demanda.';
comment on column demand_travelers.document_number_snapshot is
  'Documento do passageiro no momento da demanda; acesso deve respeitar o escopo do tenant.';
comment on column demand_travelers.birth_date_snapshot is
  'Data de nascimento do passageiro no momento da demanda.';
comment on column demand_travelers.traveler_sequence is
  'Ordem explicita do passageiro na demanda; nula apenas para registros legados.';

commit;

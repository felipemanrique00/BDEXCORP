begin;

-- Fotos de propriedades e quartos pertencem ao catalogo offline e apontam
-- para objetos privados em stored_files. O portal recebe apenas uma URL BFF
-- autenticada; storage_key, hash, usuario e demais metadados nunca saem daqui.
create table if not exists hotel_catalog_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  hotel_id text not null,
  room_type_id uuid,
  file_id uuid not null,
  alt_text text,
  sort_order smallint not null default 0 check (sort_order between 0 and 99),
  version bigint not null default 1 check (version > 0),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, file_id),
  foreign key (tenant_id, hotel_id)
    references hotels(tenant_id, id) on delete restrict,
  foreign key (tenant_id, hotel_id, room_type_id)
    references hotel_room_types(tenant_id, hotel_id, id) on delete restrict,
  foreign key (tenant_id, file_id)
    references stored_files(tenant_id, id) on delete restrict,
  check (alt_text is null or length(btrim(alt_text)) between 1 and 240)
);

create index if not exists hotel_catalog_media_gallery_idx
  on hotel_catalog_media (tenant_id, hotel_id, room_type_id, sort_order, created_at)
  where deleted_at is null;

create or replace function validate_hotel_catalog_media_scope()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.hotel_id is distinct from old.hotel_id
    or new.room_type_id is distinct from old.room_type_id
    or new.file_id is distinct from old.file_id
  ) then
    raise exception 'O tenant, hotel, quarto e arquivo da foto sao imutaveis.';
  end if;

  if not exists (
    select 1
      from stored_files file
     where file.tenant_id = new.tenant_id
       and file.id = new.file_id
       and file.status = 'active'
       and file.purpose = 'hotel_catalog_media'
       and file.entity_type = 'hotel'
       and file.entity_id = new.hotel_id
       and file.mime_type = 'image/webp'
       and file.size_bytes between 1 and 5242880
  ) then
    raise exception 'O arquivo da foto nao pertence ao hotel ou nao e uma imagem valida.';
  end if;
  return new;
end;
$$;

drop trigger if exists hotel_catalog_media_validate_scope on hotel_catalog_media;
create trigger hotel_catalog_media_validate_scope
before insert or update on hotel_catalog_media
for each row execute function validate_hotel_catalog_media_scope();

drop trigger if exists hotel_catalog_media_set_updated_at on hotel_catalog_media;
create trigger hotel_catalog_media_set_updated_at
before update on hotel_catalog_media
for each row execute function set_updated_at();

alter table hotel_catalog_media enable row level security;
alter table hotel_catalog_media force row level security;
drop policy if exists tenant_isolation on hotel_catalog_media;
create policy tenant_isolation on hotel_catalog_media
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

commit;

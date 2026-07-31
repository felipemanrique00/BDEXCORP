-- Reconcile legacy directory projections that were removed from bbt-data-v4
-- but remained active in the relational corporate directory.

update employees employee_row
set status = 'inactive',
    deleted_at = coalesce(employee_row.deleted_at, now()),
    updated_at = now()
where employee_row.deleted_at is null
  and exists (
    select 1
    from app_kv storage_row
    where storage_row.tenant_id = employee_row.tenant_id
      and storage_row.key = 'bbt-data-v4'
  )
  and not exists (
    select 1
    from app_kv storage_row
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(
          (case
             when jsonb_typeof(storage_row.value -> 'state') = 'object'
               then storage_row.value -> 'state'
             else storage_row.value
           end) -> 'funcionarios'
        ) = 'array'
          then (case
                  when jsonb_typeof(storage_row.value -> 'state') = 'object'
                    then storage_row.value -> 'state'
                  else storage_row.value
                end) -> 'funcionarios'
        else '[]'::jsonb
      end
    ) directory_item
    where storage_row.tenant_id = employee_row.tenant_id
      and storage_row.key = 'bbt-data-v4'
      and directory_item ->> 'id' = employee_row.id
  );

update companies company_row
set status = 'inactive',
    deleted_at = coalesce(company_row.deleted_at, now()),
    updated_at = now()
where company_row.deleted_at is null
  and exists (
    select 1
    from app_kv storage_row
    where storage_row.tenant_id = company_row.tenant_id
      and storage_row.key = 'bbt-data-v4'
  )
  and not exists (
    select 1
    from app_kv storage_row
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(
          (case
             when jsonb_typeof(storage_row.value -> 'state') = 'object'
               then storage_row.value -> 'state'
             else storage_row.value
           end) -> 'empresas'
        ) = 'array'
          then (case
                  when jsonb_typeof(storage_row.value -> 'state') = 'object'
                    then storage_row.value -> 'state'
                  else storage_row.value
                end) -> 'empresas'
        else '[]'::jsonb
      end
    ) directory_item
    where storage_row.tenant_id = company_row.tenant_id
      and storage_row.key = 'bbt-data-v4'
      and directory_item ->> 'id' = company_row.id
  );

update business_groups group_row
set status = 'inactive',
    deleted_at = coalesce(group_row.deleted_at, now()),
    updated_at = now()
where group_row.deleted_at is null
  and exists (
    select 1
    from app_kv storage_row
    where storage_row.tenant_id = group_row.tenant_id
      and storage_row.key = 'bbt-data-v4'
  )
  and not exists (
    select 1
    from app_kv storage_row
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(
          (case
             when jsonb_typeof(storage_row.value -> 'state') = 'object'
               then storage_row.value -> 'state'
             else storage_row.value
           end) -> 'gruposEmpresariais'
        ) = 'array'
          then (case
                  when jsonb_typeof(storage_row.value -> 'state') = 'object'
                    then storage_row.value -> 'state'
                  else storage_row.value
                end) -> 'gruposEmpresariais'
        else '[]'::jsonb
      end
    ) directory_item
    where storage_row.tenant_id = group_row.tenant_id
      and storage_row.key = 'bbt-data-v4'
      and directory_item ->> 'id' = group_row.id
  );

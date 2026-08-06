begin;

-- The original function referenced NEW.employee_id while also serving the
-- travel_provider_operations trigger, whose row type has no such column.
-- Keep table-specific fields inside their respective trigger branches.
create or replace function validate_travel_governance_scope()
returns trigger
language plpgsql
as $$
declare
  demand_company text;
  demand_employee text;
  related_company text;
  related_demand text;
begin
  select company_id, employee_id
    into demand_company, demand_employee
  from demands
  where tenant_id = new.tenant_id and id = new.demand_id and deleted_at is null;

  if demand_company is null then
    raise exception 'Demanda inexistente ou removida para o tenant informado.';
  end if;
  if demand_company <> new.company_id then
    raise exception 'Empresa da operacao nao corresponde a empresa da demanda.';
  end if;

  if tg_table_name = 'travel_quotes' then
    if new.employee_id is not null and demand_employee is distinct from new.employee_id then
      raise exception 'Funcionario da cotacao nao corresponde ao funcionario da demanda.';
    end if;
  elsif tg_table_name = 'travel_provider_operations' then
    if new.reservation_id is not null then
      select company_id, demand_id into related_company, related_demand
      from reservations
      where tenant_id = new.tenant_id and id = new.reservation_id;
      if related_company is distinct from new.company_id or related_demand is distinct from new.demand_id then
        raise exception 'Reserva fora do escopo da demanda/empresa.';
      end if;
    end if;

    if new.quote_id is not null then
      select company_id, demand_id into related_company, related_demand
      from travel_quotes
      where tenant_id = new.tenant_id and id = new.quote_id;
      if related_company is distinct from new.company_id or related_demand is distinct from new.demand_id then
        raise exception 'Cotacao fora do escopo da demanda/empresa.';
      end if;
    end if;

    if new.quote_option_id is not null and not exists (
      select 1 from travel_quote_options option_row
      join travel_quotes quote_row
        on quote_row.tenant_id = option_row.tenant_id and quote_row.id = option_row.quote_id
      where option_row.tenant_id = new.tenant_id and option_row.id = new.quote_option_id
        and quote_row.id = new.quote_id and quote_row.demand_id = new.demand_id
        and quote_row.company_id = new.company_id
    ) then
      raise exception 'Opcao de cotacao fora do escopo da operacao.';
    end if;

    if new.budget_commitment_id is not null and not exists (
      select 1 from budget_commitments commitment
      join budgets budget
        on budget.tenant_id = commitment.tenant_id and budget.id = commitment.budget_id
      where commitment.tenant_id = new.tenant_id and commitment.id = new.budget_commitment_id
        and commitment.demand_id = new.demand_id and budget.company_id = new.company_id
    ) then
      raise exception 'Compromisso orcamentario fora do escopo da operacao.';
    end if;
  end if;

  return new;
end;
$$;

commit;

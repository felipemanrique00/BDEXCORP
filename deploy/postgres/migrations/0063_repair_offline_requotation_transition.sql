begin;

-- Uma nova rodada de cotacao expira a anterior e devolve a demanda de
-- pending_choice para quoting. A maquina TypeScript ja permite esse comando;
-- esta reparacao mantem o guard de banco alinhado com a mesma transicao.
create or replace function enforce_demand_lifecycle_transition()
returns trigger
language plpgsql
as $$
declare
  lifecycle_command text;
  idempotency_key text;
  transition_key text;
  allowed_transitions text[] := array[
    'draft>submitted', 'submitted>pending_merit_approval', 'submitted>approved_for_quotation',
    'pending_merit_approval>approved_for_quotation', 'approved_for_quotation>quoting',
    'quoting>pending_choice', 'pending_choice>quoting',
    'pending_choice>pending_cost_approval', 'pending_choice>approved',
    'approved>pending_cost_approval', 'pending_cost_approval>approved',
    'pending_cost_approval>pending_choice', 'approved>reserving',
    'reserving>reserved', 'reserved>pending_issuance', 'pending_issuance>issuing',
    'partially_issued>issuing', 'issuing>issued', 'partially_issued>issued',
    'issuing>partially_issued', 'submitted>rejected', 'pending_merit_approval>rejected',
    'pending_choice>rejected', 'pending_cost_approval>rejected', 'issued>pending_refund',
    'partially_issued>pending_refund', 'canceled>pending_refund', 'pending_refund>refunded',
    'issued>closed', 'refunded>closed'
  ];
begin
  if new.lifecycle_status is not distinct from old.lifecycle_status then return new; end if;
  lifecycle_command := nullif(current_setting('app.lifecycle_command', true), '');
  idempotency_key := nullif(current_setting('app.idempotency_key', true), '');
  if lifecycle_command is null or idempotency_key is null then
    raise exception 'Transicao de ciclo de vida exige comando e chave de idempotencia.';
  end if;
  transition_key := old.lifecycle_status || '>' || new.lifecycle_status;
  if not (transition_key = any(allowed_transitions))
    and not (new.lifecycle_status = 'canceled' and old.lifecycle_status not in ('rejected', 'expired', 'closed'))
    and not (new.lifecycle_status = 'expired' and old.lifecycle_status not in ('issued', 'refunded', 'rejected', 'canceled', 'closed'))
    and not (new.lifecycle_status = 'failed' and old.lifecycle_status not in ('draft', 'issued', 'refunded', 'rejected', 'canceled', 'expired', 'closed'))
  then
    raise exception 'Transicao de ciclo de vida invalida: %', transition_key;
  end if;
  if new.lifecycle_version <> old.lifecycle_version + 1 then
    raise exception 'Versao do ciclo de vida deve ser incrementada em uma unidade.';
  end if;
  if new.last_transition_at is null then
    raise exception 'Data da transicao e obrigatoria.';
  end if;
  return new;
end;
$$;

commit;

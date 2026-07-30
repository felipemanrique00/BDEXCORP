insert into permissions (permission_key, module, description) values
  ('operar_cotacoes', 'operacao', 'Pesquisar e tarifar opcoes de viagem'),
  ('operar_reservas', 'operacao', 'Criar e alterar reservas nos provedores homologados'),
  ('operar_emissoes', 'operacao', 'Emitir bilhetes e servicos reservados'),
  ('operar_cancelamentos', 'operacao', 'Cancelar reservas e bilhetes emitidos'),
  ('gerenciar_integracoes', 'integracoes', 'Consultar e operar configuracoes de integracoes de viagens')
on conflict (permission_key) do update set
  module = excluded.module,
  description = excluded.description;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, permission.permission_key, true
from roles role_row
join permissions permission on permission.permission_key in (
  'operar_cotacoes', 'operar_reservas', 'operar_emissoes',
  'operar_cancelamentos', 'gerenciar_integracoes'
)
where role_row.role_key in ('tenant_admin', 'agent', 'supervisor', 'operator')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into role_permissions (role_id, permission_key, allowed)
select role_row.id, 'operar_cotacoes', true
from roles role_row
where role_row.role_key = 'financial_manager'
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

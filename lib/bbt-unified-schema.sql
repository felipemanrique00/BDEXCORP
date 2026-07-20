-- BBT Corporativo V12 - schema unificado Supabase/Postgres
-- Objetivo: manter demandas, vouchers criados, vouchers importados, arquivos,
-- entidades de CRM/ERP e eventos da IA no mesmo banco pesquisavel.

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

create table if not exists bbt_empresas (
  id text primary key,
  nome text not null,
  cnpj text,
  codigo_cliente text,
  responsavel text,
  email_responsavel text,
  telefone text,
  centro_custo_padrao text,
  ativa boolean not null default true,
  config_cobranca jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bbt_funcionarios (
  id text primary key,
  company_id text not null references bbt_empresas(id) on delete cascade,
  nome text not null,
  cpf text,
  email text,
  telefone text,
  cargo text,
  centro_custo text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bbt_hoteis (
  id bigint primary key,
  nome text not null,
  cidade text,
  uf text,
  telefone text,
  email text,
  endereco text,
  categoria text,
  faturado boolean default false,
  tarifas jsonb not null default '{}'::jsonb,
  formas_pagamento jsonb not null default '[]'::jsonb,
  fonte_url text,
  fonte_titulo text,
  criado_por_ia boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bbt_demandas (
  id text primary key,
  empresa_id text not null references bbt_empresas(id),
  funcionario_id text references bbt_funcionarios(id),
  passageiro_nome text not null,
  tipo_servico text not null check (tipo_servico in ('Aereo', 'Aéreo', 'Hotel', 'Carro', 'Pacote', 'Outro')),
  status text not null,
  prioridade text not null default 'media',
  origem text,
  origem_emissao text,
  agente_user_id text,
  observacoes text,
  dados_servico jsonb not null default '{}'::jsonb,
  financeiro jsonb not null default '{}'::jsonb,
  voucher_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalizado_em timestamptz
);

create table if not exists bbt_vouchers (
  id text primary key,
  numero text not null,
  tipo text not null check (tipo in ('Aereo', 'Aéreo', 'Hotel', 'Carro', 'Pacote')),
  status text not null,
  origem_voucher text not null default 'criado' check (origem_voucher in ('criado', 'importado', 'pdf', 'ia')),
  atendimento_id text references bbt_demandas(id) on delete set null,
  empresa_id text not null references bbt_empresas(id),
  funcionario_id text references bbt_funcionarios(id),
  passageiro_nome text not null,
  passageiros jsonb not null default '[]'::jsonb,
  fornecedor_nome text not null,
  fornecedor_cidade text,
  fornecedor_telefone text,
  dados_servico jsonb not null default '{}'::jsonb,
  dados_confirmacao jsonb not null default '{}'::jsonb,
  financeiro jsonb not null default '{}'::jsonb,
  total numeric(14,2) not null default 0,
  arquivo_original_nome text,
  importado_em timestamptz,
  fingerprint text unique,
  emitido_por_user_id text,
  emitido_por_user_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bbt_arquivos_operacionais (
  id uuid primary key default uuid_generate_v4(),
  entidade_tipo text not null check (entidade_tipo in ('demanda', 'voucher', 'empresa', 'funcionario', 'hotel')),
  entidade_id text not null,
  nome_original text not null,
  mime_type text,
  tamanho_bytes bigint,
  storage_path text,
  origem text,
  texto_extraido text,
  metadados jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists bbt_ai_eventos (
  id uuid primary key default uuid_generate_v4(),
  user_id text,
  provedor text not null,
  modelo text,
  tarefa text not null,
  pergunta text,
  resposta_resumo text,
  entidades_afetadas jsonb not null default '[]'::jsonb,
  fontes jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists bbt_unified_index (
  id uuid primary key default uuid_generate_v4(),
  entity_kind text not null,
  entity_id text not null,
  title text not null,
  subtitle text,
  search_text text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(entity_kind, entity_id)
);

create index if not exists bbt_funcionarios_nome_trgm on bbt_funcionarios using gin (nome gin_trgm_ops);
create index if not exists bbt_hoteis_nome_trgm on bbt_hoteis using gin (nome gin_trgm_ops);
create index if not exists bbt_demandas_search_trgm on bbt_demandas using gin ((passageiro_nome || ' ' || coalesce(observacoes, '')) gin_trgm_ops);
create index if not exists bbt_vouchers_search_trgm on bbt_vouchers using gin ((id || ' ' || passageiro_nome || ' ' || fornecedor_nome || ' ' || coalesce(fornecedor_cidade, '')) gin_trgm_ops);
create index if not exists bbt_unified_index_search_trgm on bbt_unified_index using gin (search_text gin_trgm_ops);

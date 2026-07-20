-- ============================================================
-- SCHEMA SUPABASE - Sistema BBT Corporativo
-- ============================================================
-- Este arquivo contém o schema completo para migrar o sistema
-- do modo LOCAL (localStorage) para Supabase PostgreSQL com RLS.
--
-- Como usar:
-- 1. Crie uma conta em https://supabase.com (grátis)
-- 2. Crie um novo projeto
-- 3. Vá em SQL Editor > New Query
-- 4. Cole este arquivo inteiro e rode
-- 5. Preencha .env.local com NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY
-- 6. Contrate um dev para substituir lib/store.ts por chamadas ao Supabase
-- ============================================================

-- Habilita extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============ TABELAS ============

-- Empresas (tenants)
CREATE TABLE empresas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome TEXT NOT NULL,
  cnpj TEXT UNIQUE NOT NULL,
  endereco TEXT,
  responsavel TEXT,
  email_responsavel TEXT,
  telefone TEXT,
  centro_custo_padrao TEXT,
  ativa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usuários (extende auth.users do Supabase)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('master', 'company_admin', 'colaborador')),
  company_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Funcionários
CREATE TABLE funcionarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cpf TEXT NOT NULL,
  data_nascimento DATE,
  telefone TEXT,
  email TEXT,
  passaporte TEXT,
  passaporte_validade DATE,
  milhagem TEXT,
  preferencias TEXT,
  cargo TEXT NOT NULL CHECK (cargo IN ('Diretor', 'Gerente', 'Colaborador')),
  centro_custo TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hotéis (globais, não multi-tenant)
CREATE TABLE hoteis (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  observacoes TEXT,
  telefone TEXT,
  faturado BOOLEAN DEFAULT false,
  info_faturamento TEXT,
  bebedouro TEXT,
  valor_agua NUMERIC(10,2),
  cafe_manha TEXT,
  estacionamento TEXT,
  tarifa_sgl NUMERIC(10,2),
  tarifa_dbl NUMERIC(10,2),
  tarifa_tpl NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Políticas por cargo (multi-tenant)
CREATE TABLE politicas_cargo (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cargo TEXT NOT NULL CHECK (cargo IN ('Diretor', 'Gerente', 'Colaborador')),
  limite_diaria_hotel NUMERIC(10,2) DEFAULT 300,
  classe_aerea TEXT DEFAULT 'Econômica',
  aprovacao_automatica BOOLEAN DEFAULT false,
  hoteis_max_estrelas INT DEFAULT 3,
  observacoes TEXT,
  UNIQUE(company_id, cargo)
);

-- Arquivos (uso com Supabase Storage)
CREATE TABLE arquivos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  funcionario_id UUID REFERENCES funcionarios(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  path_storage TEXT NOT NULL,
  mime_type TEXT,
  tamanho_bytes BIGINT,
  enviado_por UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ ÍNDICES ============
CREATE INDEX idx_funcionarios_company ON funcionarios(company_id);
CREATE INDEX idx_funcionarios_cargo ON funcionarios(cargo);
CREATE INDEX idx_funcionarios_cpf ON funcionarios(cpf);
CREATE INDEX idx_hoteis_uf ON hoteis(uf);
CREATE INDEX idx_hoteis_cidade ON hoteis(cidade);
CREATE INDEX idx_politicas_company ON politicas_cargo(company_id);
CREATE INDEX idx_users_company ON users(company_id);

-- ============ ROW LEVEL SECURITY (RLS) ============
-- Habilita RLS em todas as tabelas sensíveis
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE hoteis ENABLE ROW LEVEL SECURITY;
ALTER TABLE politicas_cargo ENABLE ROW LEVEL SECURITY;
ALTER TABLE arquivos ENABLE ROW LEVEL SECURITY;

-- Função auxiliar: pegar role do usuário logado
CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Função auxiliar: pegar company_id do usuário logado
CREATE OR REPLACE FUNCTION current_user_company() RETURNS UUID AS $$
  SELECT company_id FROM users WHERE id = auth.uid()
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ============ POLICIES ============

-- EMPRESAS
-- Master vê e edita tudo; Company Admin/Colaborador vê só a própria empresa
CREATE POLICY "empresas_select_policy" ON empresas FOR SELECT
  USING (
    current_user_role() = 'master'
    OR id = current_user_company()
  );

CREATE POLICY "empresas_insert_policy" ON empresas FOR INSERT
  WITH CHECK (current_user_role() = 'master');

CREATE POLICY "empresas_update_policy" ON empresas FOR UPDATE
  USING (
    current_user_role() = 'master'
    OR (current_user_role() = 'company_admin' AND id = current_user_company())
  );

CREATE POLICY "empresas_delete_policy" ON empresas FOR DELETE
  USING (current_user_role() = 'master');

-- USERS
CREATE POLICY "users_select_policy" ON users FOR SELECT
  USING (
    current_user_role() = 'master'
    OR company_id = current_user_company()
    OR id = auth.uid()
  );

CREATE POLICY "users_modify_policy" ON users FOR ALL
  USING (
    current_user_role() = 'master'
    OR (current_user_role() = 'company_admin' AND company_id = current_user_company())
  );

-- FUNCIONÁRIOS
CREATE POLICY "funcionarios_select_policy" ON funcionarios FOR SELECT
  USING (
    current_user_role() = 'master'
    OR company_id = current_user_company()
  );

CREATE POLICY "funcionarios_modify_policy" ON funcionarios FOR ALL
  USING (
    current_user_role() = 'master'
    OR (current_user_role() = 'company_admin' AND company_id = current_user_company())
  );

-- HOTÉIS (leitura pública para logados; escrita só Master)
CREATE POLICY "hoteis_select_policy" ON hoteis FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "hoteis_modify_policy" ON hoteis FOR ALL
  USING (current_user_role() = 'master');

-- POLÍTICAS POR CARGO
CREATE POLICY "politicas_select_policy" ON politicas_cargo FOR SELECT
  USING (
    current_user_role() = 'master'
    OR company_id = current_user_company()
  );

CREATE POLICY "politicas_modify_policy" ON politicas_cargo FOR ALL
  USING (
    current_user_role() = 'master'
    OR (current_user_role() = 'company_admin' AND company_id = current_user_company())
  );

-- ARQUIVOS
CREATE POLICY "arquivos_select_policy" ON arquivos FOR SELECT
  USING (
    current_user_role() = 'master'
    OR company_id = current_user_company()
  );

CREATE POLICY "arquivos_modify_policy" ON arquivos FOR ALL
  USING (
    current_user_role() = 'master'
    OR (current_user_role() = 'company_admin' AND company_id = current_user_company())
    OR enviado_por = auth.uid()
  );

-- ============ SEED DE DADOS INICIAL ============
-- Crie seu usuário Master manualmente via Supabase Auth > Users,
-- depois rode:
-- INSERT INTO users (id, email, name, role) VALUES
--   ('<uuid-do-usuario>', 'master@bbt.com', 'Administrador Master', 'master');

-- ============ FIM DO SCHEMA ============

import type { User } from '@/types'

export const SUPER_MASTER: User = {
  id: 'usr-felipe-master',
  email: 'manriquefelipe010@gmail.com',
  name: 'Felipe Manrique',
  role: 'master',
  company_id: null,
  perfil_bbt: 'lider',
  ativo: true,
  created_at: '2026-01-01T00:00:00.000Z',
}

export function getServerSuperMasterPassword(): string {
  return process.env.BBT_SUPER_MASTER_PASSWORD || process.env.BBT_DEV_MASTER_PASSWORD || ''
}

// ============================================================
// Store Global (Zustand) V4 - persistido em localStorage
// Base real: sem dados fake, sem empresas/hoteis/demandas automaticas.
// ============================================================
'use client'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Empresa, Funcionario, Hotel, PoliticaCargo, ConfigCobrancaEmpresa, GrupoEmpresarial } from '@/types'
import { CONFIG_COBRANCA_PADRAO } from '@/types'
import { safeGetRaw, safeRemove, safeSetRaw } from '@/lib/storage-quota'
import { aplicarVinculoEmpresaGrupo, gerarIdGrupoEmpresarial, sincronizarGruposComEmpresas } from '@/lib/grupos'
import { garantirCodigoIdentificacao, normalizarAliasesFuncionario, normalizarFuncionariosComCodigo } from '@/lib/funcionario-identidade'
import { createEntityId } from '@/lib/ids'

interface DataState {
  empresas: Empresa[]
  gruposEmpresariais: GrupoEmpresarial[]
  funcionarios: Funcionario[]
  hoteis: Hotel[]
  politicas: PoliticaCargo[]

  addEmpresa: (e: Omit<Empresa, 'id' | 'created_at'>) => Empresa | null
  updateEmpresa: (id: string, patch: Partial<Empresa>) => void
  deleteEmpresa: (id: string) => void
  updateConfigCobranca: (empresaId: string, config: ConfigCobrancaEmpresa) => void

  addGrupoEmpresarial: (grupo: Omit<GrupoEmpresarial, 'id' | 'created_at' | 'updated_at'>) => GrupoEmpresarial | null
  updateGrupoEmpresarial: (id: string, patch: Partial<GrupoEmpresarial>) => void
  deleteGrupoEmpresarial: (id: string) => void
  vincularEmpresaGrupo: (empresaId: string, grupoId: string) => void
  desvincularEmpresaGrupo: (empresaId: string) => void

  addFuncionario: (f: Omit<Funcionario, 'id' | 'created_at'>) => Funcionario | null
  updateFuncionario: (id: string, patch: Partial<Funcionario>) => void
  deleteFuncionario: (id: string) => void

  addHotel: (h: Omit<Hotel, 'id'>) => Hotel
  updateHotel: (id: number, patch: Partial<Hotel>) => void
  deleteHotel: (id: number) => void
  importHoteis: (hoteis: Omit<Hotel, 'id'>[]) => number
  adicionarCadastrosEmLote: (cadastros: {
    empresas?: Empresa[]
    funcionarios?: Funcionario[]
    hoteis?: Hotel[]
  }) => { empresas: number; funcionarios: number; hoteis: number }

  updatePolitica: (id: string, patch: Partial<PoliticaCargo>) => void
  addPolitica: (p: Omit<PoliticaCargo, 'id'>) => void
  deletePolitica: (id: string) => void

  resetarBaseReal: () => void
}

export const useStore = create<DataState>()(
  persist(
    (set, get) => ({
      empresas: [],
      gruposEmpresariais: [],
      funcionarios: [],
      hoteis: [],
      politicas: [],

      addEmpresa: (e) => {
        const novo: Empresa = {
          ...e,
          portal_empresa_habilitado: e.portal_empresa_habilitado === true,
          id: createEntityId('emp'),
          created_at: new Date().toISOString(),
          config_cobranca: e.config_cobranca || { ...CONFIG_COBRANCA_PADRAO },
        }
        set((s) => ({
          empresas: [...s.empresas, novo],
          gruposEmpresariais: novo.grupo_id
            ? aplicarVinculoEmpresaGrupo(s.gruposEmpresariais, novo.id, novo.grupo_id)
            : s.gruposEmpresariais,
        }))
        return novo
      },
      updateEmpresa: (id, patch) => {
        set((s) => ({
          empresas: s.empresas.map((e) => (e.id === id ? { ...e, ...patch, updated_at: new Date().toISOString() } : e)),
          gruposEmpresariais:
            'grupo_id' in patch
              ? aplicarVinculoEmpresaGrupo(s.gruposEmpresariais, id, patch.grupo_id)
              : s.gruposEmpresariais,
        }))
      },
      deleteEmpresa: (id) => {
        set((s) => ({
          empresas: s.empresas.filter((e) => e.id !== id),
          gruposEmpresariais: aplicarVinculoEmpresaGrupo(s.gruposEmpresariais, id, null),
          funcionarios: s.funcionarios.filter((f) => f.company_id !== id),
          politicas: s.politicas.filter((p) => p.company_id !== id),
        }))
      },
      updateConfigCobranca: (empresaId, config) => {
        set((s) => ({
          empresas: s.empresas.map((e) => (e.id === empresaId ? { ...e, config_cobranca: config } : e)),
        }))
      },

      addGrupoEmpresarial: (grupo) => {
        const now = new Date().toISOString()
        const novo: GrupoEmpresarial = {
          ...grupo,
          id: gerarIdGrupoEmpresarial(),
          empresa_ids: Array.from(new Set(grupo.empresa_ids || [])),
          ativo: grupo.ativo !== false,
          created_at: now,
          updated_at: now,
        }
        set((s) => ({
          gruposEmpresariais: [...s.gruposEmpresariais, novo],
          empresas: s.empresas.map((empresa) =>
            novo.empresa_ids.includes(empresa.id) ? { ...empresa, grupo_id: novo.id, updated_at: now } : empresa,
          ),
        }))
        return novo
      },
      updateGrupoEmpresarial: (id, patch) => {
        const now = new Date().toISOString()
        set((s) => {
          const patchControlaEmpresas = Object.prototype.hasOwnProperty.call(patch, 'empresa_ids')
          const empresaIdsPatch = new Set(Array.from(new Set(patch.empresa_ids || [])))
          const empresas = patchControlaEmpresas
            ? s.empresas.map((empresa) => {
                if (empresaIdsPatch.has(empresa.id)) return { ...empresa, grupo_id: id, updated_at: now }
                if (empresa.grupo_id === id) return { ...empresa, grupo_id: null, updated_at: now }
                return empresa
              })
            : s.empresas
          const gruposBase = s.gruposEmpresariais.map((grupo) =>
            grupo.id === id
              ? { ...grupo, ...patch, empresa_ids: Array.from(new Set(patchControlaEmpresas ? patch.empresa_ids || [] : grupo.empresa_ids)), updated_at: now }
              : grupo,
          )
          const grupos = sincronizarGruposComEmpresas(gruposBase, empresas)
          const grupoAtualizado = grupos.find((grupo) => grupo.id === id)
          const empresaIds = new Set(grupoAtualizado?.empresa_ids || [])
          return {
            gruposEmpresariais: grupos,
            empresas: empresas.map((empresa) => {
              if (empresaIds.has(empresa.id)) return { ...empresa, grupo_id: id, updated_at: now }
              if (empresa.grupo_id === id) return { ...empresa, grupo_id: null, updated_at: now }
              return empresa
            }),
          }
        })
      },
      deleteGrupoEmpresarial: (id) => {
        const now = new Date().toISOString()
        set((s) => ({
          gruposEmpresariais: s.gruposEmpresariais.filter((grupo) => grupo.id !== id),
          empresas: s.empresas.map((empresa) => (empresa.grupo_id === id ? { ...empresa, grupo_id: null, updated_at: now } : empresa)),
        }))
      },
      vincularEmpresaGrupo: (empresaId, grupoId) => {
        const now = new Date().toISOString()
        set((s) => ({
          empresas: s.empresas.map((empresa) => (empresa.id === empresaId ? { ...empresa, grupo_id: grupoId, updated_at: now } : empresa)),
          gruposEmpresariais: aplicarVinculoEmpresaGrupo(s.gruposEmpresariais, empresaId, grupoId),
        }))
      },
      desvincularEmpresaGrupo: (empresaId) => {
        const now = new Date().toISOString()
        set((s) => ({
          empresas: s.empresas.map((empresa) => (empresa.id === empresaId ? { ...empresa, grupo_id: null, updated_at: now } : empresa)),
          gruposEmpresariais: aplicarVinculoEmpresaGrupo(s.gruposEmpresariais, empresaId, null),
        }))
      },

      addFuncionario: (f) => {
        const now = new Date().toISOString()
        const base: Funcionario = {
          ...f,
          aliases_nome: normalizarAliasesFuncionario(f.aliases_nome),
          id: createEntityId('func'),
          created_at: now,
        }
        const novo = garantirCodigoIdentificacao(base, get().funcionarios)
        set((s) => ({ funcionarios: [...s.funcionarios, novo] }))
        return novo
      },
      updateFuncionario: (id, patch) => {
        set((s) => {
          const atual = s.funcionarios.find((f) => f.id === id)
          if (!atual) return s
          const { codigo_identificacao: _ignorarCodigo, ...patchSemCodigo } = patch
          const atualizado = garantirCodigoIdentificacao(
            {
              ...atual,
              ...patchSemCodigo,
              aliases_nome: normalizarAliasesFuncionario(
                Object.prototype.hasOwnProperty.call(patchSemCodigo, 'aliases_nome')
                  ? patchSemCodigo.aliases_nome
                  : atual.aliases_nome,
              ),
              updated_at: new Date().toISOString(),
            },
            s.funcionarios.filter((f) => f.id !== id),
          )
          return {
            funcionarios: s.funcionarios.map((f) => (f.id === id ? atualizado : f)),
          }
        })
      },
      deleteFuncionario: (id) => {
        set((s) => ({ funcionarios: s.funcionarios.filter((f) => f.id !== id) }))
      },

      addHotel: (h) => {
        const maxId = get().hoteis.reduce((max, hotel) => Math.max(max, hotel.id), 0)
        const novo: Hotel = { ...h, id: maxId + 1 }
        set((s) => ({ hoteis: [...s.hoteis, novo] }))
        return novo
      },
      updateHotel: (id, patch) => {
        set((s) => ({ hoteis: s.hoteis.map((h) => (h.id === id ? { ...h, ...patch } : h)) }))
      },
      deleteHotel: (id) => {
        set((s) => ({ hoteis: s.hoteis.filter((h) => h.id !== id) }))
      },
      importHoteis: (hoteis) => {
        let maxId = get().hoteis.reduce((max, hotel) => Math.max(max, hotel.id), 0)
        const novos: Hotel[] = hoteis.map((h) => ({ ...h, id: ++maxId }))
        set((s) => ({ hoteis: [...s.hoteis, ...novos] }))
        return novos.length
      },
      adicionarCadastrosEmLote: (cadastros) => {
        const novasEmpresas = (cadastros.empresas || []).map((empresa) => ({
          ...empresa,
          portal_empresa_habilitado: empresa.portal_empresa_habilitado === true,
        }))
        const novosFuncionarios = cadastros.funcionarios || []
        const novosHoteis = cadastros.hoteis || []
        const atual = get()

        validarIdsUnicos('empresa', atual.empresas, novasEmpresas, (item) => item.id)
        validarIdsUnicos('funcionario', atual.funcionarios, novosFuncionarios, (item) => item.id)
        validarIdsUnicos('hotel', atual.hoteis, novosHoteis, (item) => String(item.id))

        set((s) => {
          const empresas = [...s.empresas, ...novasEmpresas]
          return {
            empresas,
            gruposEmpresariais: sincronizarGruposComEmpresas(s.gruposEmpresariais, empresas),
            funcionarios: normalizarFuncionariosComCodigo([...s.funcionarios, ...novosFuncionarios]),
            hoteis: [...s.hoteis, ...novosHoteis],
          }
        })

        return {
          empresas: novasEmpresas.length,
          funcionarios: novosFuncionarios.length,
          hoteis: novosHoteis.length,
        }
      },

      updatePolitica: (id, patch) => {
        set((s) => ({ politicas: s.politicas.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
      },
      addPolitica: (p) => {
        const novo: PoliticaCargo = {
          ...p,
          id: createEntityId('pol'),
        }
        set((s) => ({ politicas: [...s.politicas, novo] }))
      },
      deletePolitica: (id) => {
        set((s) => ({ politicas: s.politicas.filter((p) => p.id !== id) }))
      },

      resetarBaseReal: () => {
        set({ empresas: [], gruposEmpresariais: [], funcionarios: [], hoteis: [], politicas: [] })
      },
    }),
    {
      name: 'bbt-data-v4',
      version: 1,
      storage: createJSONStorage(() => ({
        getItem: (name) => safeGetRaw(name),
        setItem: (name, value) => { safeSetRaw(name, value) },
        removeItem: (name) => safeRemove(name),
      })),
      merge: (persisted, current) => {
        const data = persisted as Partial<DataState> | undefined
        if (!data) return current

        return {
          ...current,
          ...data,
          empresas: Array.isArray(data.empresas) ? data.empresas : current.empresas,
          gruposEmpresariais: sincronizarGruposComEmpresas(
            Array.isArray(data.gruposEmpresariais) ? data.gruposEmpresariais : current.gruposEmpresariais,
            Array.isArray(data.empresas) ? data.empresas : current.empresas,
          ),
          funcionarios: normalizarFuncionariosComCodigo(Array.isArray(data.funcionarios) ? data.funcionarios : current.funcionarios),
          hoteis: Array.isArray(data.hoteis) ? data.hoteis : current.hoteis,
          politicas: Array.isArray(data.politicas) ? data.politicas : current.politicas,
        }
      },
    },
  ),
)

function validarIdsUnicos<T>(
  entidade: string,
  existentes: T[],
  novos: T[],
  getId: (item: T) => string,
): void {
  const ids = new Set(existentes.map(getId))
  for (const item of novos) {
    const id = getId(item)
    if (!id || ids.has(id)) {
      throw new Error(`ID duplicado ao importar ${entidade}: ${id || 'vazio'}`)
    }
    ids.add(id)
  }
}

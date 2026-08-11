'use client'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from 'sonner'
import { Plane, Hotel as HotelIcon, Star, Clock, DollarSign, CheckCircle2 } from 'lucide-react'
import type { PoliticaCargo, ClasseAerea, Cargo } from '@/types'
import { NumericDecimalInput } from '@/components/ui/decimal-input'

interface Props {
  open: boolean
  onClose: () => void
  politica: PoliticaCargo | null
  /** Para criação (sem id ainda) */
  novaParaEmpresa?: { company_id: string; cargo: Cargo }
  onSave: (patch: Partial<PoliticaCargo>) => void
}

const DEFAULTS_POR_CARGO: Record<Cargo, Partial<PoliticaCargo>> = {
  Diretor: {
    titulo: 'Diretoria',
    escalao: 'Alto Escalão',
    limite_diaria_hotel: 800,
    hoteis_max_estrelas: 5,
    antecedencia_hotel_dias: 3,
    classe_aerea: 'Executiva',
    classe_aerea_internacional: 'Executiva',
    valor_maximo_aereo_domestico: 3000,
    valor_maximo_aereo_internacional: 15000,
    antecedencia_aereo_domestico_dias: 3,
    antecedencia_aereo_internacional_dias: 10,
    aprovacao_automatica: true,
    politica_hotel_texto: 'Preferência por hotéis com estrutura corporativa (sala de reunião/business center), localização central ou executiva, café da manhã incluso.',
    politica_aerea_texto: 'Bagagem despachada liberada. Acesso a salas VIP quando possível.',
  },
  Gerente: {
    titulo: 'Gerência',
    escalao: 'Gestão',
    limite_diaria_hotel: 500,
    hoteis_max_estrelas: 4,
    antecedencia_hotel_dias: 7,
    classe_aerea: 'Econômica',
    classe_aerea_internacional: 'Econômica Premium',
    valor_maximo_aereo_domestico: 1800,
    valor_maximo_aereo_internacional: 8000,
    antecedencia_aereo_domestico_dias: 7,
    antecedencia_aereo_internacional_dias: 15,
    aprovacao_automatica: false,
    politica_hotel_texto: 'Hotel com Wi-Fi de qualidade, boa avaliação, localização funcional, check-in ágil (redes conhecidas).',
    politica_aerea_texto: 'Preferência por voos diretos quando possível. Bagagem despachada 1x23kg.',
  },
  Colaborador: {
    titulo: 'Colaboradores',
    escalao: 'Operacional',
    limite_diaria_hotel: 300,
    hoteis_max_estrelas: 3,
    antecedencia_hotel_dias: 10,
    classe_aerea: 'Econômica',
    classe_aerea_internacional: 'Econômica',
    valor_maximo_aereo_domestico: 1200,
    valor_maximo_aereo_internacional: 5000,
    antecedencia_aereo_domestico_dias: 10,
    antecedencia_aereo_internacional_dias: 21,
    aprovacao_automatica: false,
    politica_hotel_texto: 'Obrigatório: boa cama + banheiro funcional. Prioridade: redes econômicas confiáveis (ex: Ibis, B&B). Evitar localizações de risco.',
    politica_aerea_texto: 'Somente voos econômicos. Bagagem somente de mão quando possível.',
  },
}

const CLASSES: ClasseAerea[] = ['Econômica', 'Econômica Premium', 'Executiva', 'Primeira']

export function PoliticaModal({ open, onClose, politica, novaParaEmpresa, onSave }: Props) {
  const [form, setForm] = useState<Partial<PoliticaCargo>>({})
  const [tab, setTab] = useState<'geral' | 'hotel' | 'aereo'>('geral')

  useEffect(() => {
    if (!open) return
    if (politica) {
      // Garante defaults para campos opcionais
      const cargo = politica.cargo
      const defaults = DEFAULTS_POR_CARGO[cargo]
      setForm({ ...defaults, ...politica })
    } else if (novaParaEmpresa) {
      const defaults = DEFAULTS_POR_CARGO[novaParaEmpresa.cargo]
      setForm({
        ...defaults,
        company_id: novaParaEmpresa.company_id,
        cargo: novaParaEmpresa.cargo,
      })
    }
    setTab('geral')
  }, [open, politica, novaParaEmpresa])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSave(form)
  }

  const title = politica
    ? `Editar Política — ${form.titulo || politica.cargo}`
    : novaParaEmpresa
    ? `Nova Política — ${novaParaEmpresa.cargo}`
    : 'Política'

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <form onSubmit={submit} className="space-y-5">
        {/* TABS internas */}
        <div className="flex gap-1 border-b border-bbt-gray-100 dark:border-slate-700 -mx-4 px-4">
          <TabBtn active={tab === 'geral'} onClick={() => setTab('geral')} icon={CheckCircle2}>Geral</TabBtn>
          <TabBtn active={tab === 'hotel'} onClick={() => setTab('hotel')} icon={HotelIcon}>Hotel</TabBtn>
          <TabBtn active={tab === 'aereo'} onClick={() => setTab('aereo')} icon={Plane}>Aéreo</TabBtn>
        </div>

        {/* GERAL */}
        {tab === 'geral' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Título (ex: Diretoria)">
                <input value={form.titulo || ''} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className="bbt-input" />
              </Field>
              <Field label="Escalão (ex: Alto Escalão)">
                <input value={form.escalao || ''} onChange={(e) => setForm({ ...form, escalao: e.target.value })} className="bbt-input" />
              </Field>
            </div>
            <div className="flex items-center gap-2 bg-bbt-gray-50 dark:bg-slate-900/40 p-3 rounded-lg">
              <input type="checkbox" id="auto" checked={form.aprovacao_automatica || false} onChange={(e) => setForm({ ...form, aprovacao_automatica: e.target.checked })} />
              <label htmlFor="auto" className="text-sm cursor-pointer">
                <strong>Aprovação automática</strong> — permite exceções ao limite sem precisar de autorizador
              </label>
            </div>
            <Field label="Observações gerais">
              <textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={3} className="bbt-input" />
            </Field>
          </div>
        )}

        {/* HOTEL */}
        {tab === 'hotel' && (
          <div className="space-y-4">
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-3 text-xs text-purple-800 dark:text-purple-200 flex items-center gap-2">
              <HotelIcon className="w-4 h-4" /> Regras aplicáveis a reservas de hospedagem
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Limite de Diária (R$) *" icon={DollarSign}>
                <NumericDecimalInput value={form.limite_diaria_hotel || 0} emptyValue={0} onNumberChange={(value) => setForm({ ...form, limite_diaria_hotel: value ?? 0 })} required />
              </Field>
              <Field label="Máx. Estrelas" icon={Star}>
                <select value={form.hoteis_max_estrelas || 3} onChange={(e) => setForm({ ...form, hoteis_max_estrelas: parseInt(e.target.value) })} className="bbt-input">
                  <option value={2}>Até 2 ⭐</option>
                  <option value={3}>Até 3 ⭐</option>
                  <option value={4}>Até 4 ⭐</option>
                  <option value={5}>Até 5 ⭐</option>
                </select>
              </Field>
              <Field label="Antecedência Mínima (dias)" icon={Clock}>
                <input type="number" min={0} value={form.antecedencia_hotel_dias ?? 0} onChange={(e) => setForm({ ...form, antecedencia_hotel_dias: parseInt(e.target.value) || 0 })} className="bbt-input" />
              </Field>
            </div>
            <Field label="Regras / Observações de Hotel">
              <textarea value={form.politica_hotel_texto || ''} onChange={(e) => setForm({ ...form, politica_hotel_texto: e.target.value })} rows={4} className="bbt-input" placeholder="Ex: Preferência por hotéis com estrutura corporativa..." />
            </Field>
          </div>
        )}

        {/* AÉREO */}
        {tab === 'aereo' && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-200 flex items-center gap-2">
              <Plane className="w-4 h-4" /> Regras aplicáveis a passagens aéreas
            </div>

            <div className="font-semibold text-xs uppercase tracking-wider text-slate-500">Doméstico</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Classe Doméstica *">
                <select value={form.classe_aerea || 'Econômica'} onChange={(e) => setForm({ ...form, classe_aerea: e.target.value as ClasseAerea })} className="bbt-input">
                  {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Valor Máx. Doméstico (R$)" icon={DollarSign}>
                <NumericDecimalInput value={form.valor_maximo_aereo_domestico || 0} emptyValue={0} onNumberChange={(value) => setForm({ ...form, valor_maximo_aereo_domestico: value ?? 0 })} />
              </Field>
              <Field label="Antecedência Doméstico (dias)" icon={Clock}>
                <input type="number" min={0} value={form.antecedencia_aereo_domestico_dias ?? 0} onChange={(e) => setForm({ ...form, antecedencia_aereo_domestico_dias: parseInt(e.target.value) || 0 })} className="bbt-input" />
              </Field>
            </div>

            <div className="font-semibold text-xs uppercase tracking-wider text-slate-500 pt-2 border-t border-bbt-gray-100 dark:border-slate-700">Internacional</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Classe Internacional">
                <select value={form.classe_aerea_internacional || 'Econômica'} onChange={(e) => setForm({ ...form, classe_aerea_internacional: e.target.value as ClasseAerea })} className="bbt-input">
                  {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Valor Máx. Internacional (R$)" icon={DollarSign}>
                <NumericDecimalInput value={form.valor_maximo_aereo_internacional || 0} emptyValue={0} onNumberChange={(value) => setForm({ ...form, valor_maximo_aereo_internacional: value ?? 0 })} />
              </Field>
              <Field label="Antecedência Intl. (dias)" icon={Clock}>
                <input type="number" min={0} value={form.antecedencia_aereo_internacional_dias ?? 0} onChange={(e) => setForm({ ...form, antecedencia_aereo_internacional_dias: parseInt(e.target.value) || 0 })} className="bbt-input" />
              </Field>
            </div>

            <Field label="Regras / Observações Aéreas">
              <textarea value={form.politica_aerea_texto || ''} onChange={(e) => setForm({ ...form, politica_aerea_texto: e.target.value })} rows={3} className="bbt-input" placeholder="Ex: Bagagem despachada 1x23kg..." />
            </Field>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary">Salvar Política</button>
        </div>
      </form>
    </Modal>
  )
}

function TabBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: any; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition border-b-2 -mb-[1px] ${
        active ? 'text-bbt-primary dark:text-bbt-accent border-bbt-accent' : 'text-slate-500 border-transparent hover:text-slate-700 dark:hover:text-slate-300'
      }`}
    >
      <Icon className="w-4 h-4" /> {children}
    </button>
  )
}

function Field({ label, icon: Icon, children }: { label: string; icon?: any; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </label>
      {children}
    </div>
  )
}

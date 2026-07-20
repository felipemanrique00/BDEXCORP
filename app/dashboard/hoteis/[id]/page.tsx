'use client'
import { useParams, useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { formatCurrency } from '@/lib/utils'
import { WhatsAppButton } from '@/components/ui/whatsapp-button'
import { ArrowLeft, Hotel as HotelIcon, MapPin, Coffee, Car, Droplets, DollarSign, FileText } from 'lucide-react'
import Link from 'next/link'

export default function HotelDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { hoteis } = useStore()
  const h = hoteis.find((x) => x.id === parseInt(id as string))

  if (!h) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="text-slate-500 mb-4">Hotel não encontrado.</p>
        <Link href="/dashboard/hoteis" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-bbt-gray-50 dark:hover:bg-slate-800 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      <div className="bbt-card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-bbt-accent/20 to-bbt-accent/40 flex items-center justify-center">
              <HotelIcon className="w-8 h-8 text-bbt-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-bbt-primary dark:text-white">{h.nome}</h1>
              <div className="flex items-center gap-2 mt-1 text-slate-500">
                <MapPin className="w-4 h-4" />
                <span>{h.cidade}</span>
                <span className="bbt-badge bg-bbt-gray-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px]">{h.uf}</span>
              </div>
            </div>
          </div>
          <WhatsAppButton phone={h.telefone} />
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {h.faturado && <span className="bbt-badge bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">✓ Faturado</span>}
          {h.cafe_manha === 'SIM' && <span className="bbt-badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">☕ Café da Manhã</span>}
          {h.bebedouro === 'SIM' && <span className="bbt-badge bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">💧 Bebedouro</span>}
          {h.estacionamento && <span className="bbt-badge bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">🅿️ {h.estacionamento}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TarifaCard label="Individual (SGL)" value={h.tarifa_sgl} />
        <TarifaCard label="Duplo (DBL)" value={h.tarifa_dbl} />
        <TarifaCard label="Triplo (TPL)" value={h.tarifa_tpl} />
      </div>

      {h.observacoes && (
        <div className="bbt-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-bbt-accent" />
            <h3 className="font-semibold text-bbt-primary dark:text-white">Observações</h3>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{h.observacoes}</p>
        </div>
      )}

      {(h.info_faturamento || h.valor_agua) && (
        <div className="bbt-card p-6">
          <h3 className="font-semibold text-bbt-primary dark:text-white mb-3">Informações Adicionais</h3>
          <div className="space-y-2 text-sm">
            {h.info_faturamento && <div><span className="text-slate-500">Faturamento:</span> {h.info_faturamento}</div>}
            {h.valor_agua && <div><span className="text-slate-500">Valor Água:</span> {formatCurrency(h.valor_agua)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function TarifaCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="bbt-card p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        <DollarSign className="w-4 h-4 text-bbt-accent" />
      </div>
      <div className="text-3xl font-bold text-bbt-primary dark:text-white mt-2">
        {value ? formatCurrency(value) : <span className="text-slate-300 text-lg">Sob consulta</span>}
      </div>
    </div>
  )
}

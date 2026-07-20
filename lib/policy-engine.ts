// ============================================================
// POLICY ENGINE — V13
//
// Motor de validação de política corporativa (inspirado em Concur
// Policy Navigator e Navan Dynamic Policy).
//
// Recebe um Atendimento + a empresa + o funcionário e retorna a
// lista de violações de política, classificadas por severidade.
//
// Não bloqueia nada — apenas DETECTA. A decisão (bloquear, exigir
// aprovação, alertar) é tomada por `approval-workflow.ts`.
// ============================================================

import type {
  Atendimento,
  Cargo,
  ClasseAerea,
  Empresa,
  Funcionario,
  PoliticaCargo,
} from '@/types'

export type ViolacaoSeveridade = 'info' | 'aviso' | 'bloqueio'

export type ViolacaoCodigo =
  | 'hotel_diaria_acima_limite'
  | 'hotel_estrelas_acima_limite'
  | 'hotel_antecedencia_insuficiente'
  | 'aereo_classe_acima'
  | 'aereo_valor_domestico_acima'
  | 'aereo_valor_internacional_acima'
  | 'aereo_antecedencia_insuficiente_dom'
  | 'aereo_antecedencia_insuficiente_int'
  | 'sem_centro_custo'
  | 'sem_autorizador'
  | 'cargo_funcionario_indefinido'
  | 'sem_politica_aplicavel'

export interface Violacao {
  codigo: ViolacaoCodigo
  severidade: ViolacaoSeveridade
  titulo: string
  detalhe: string
  valor_atual?: number | string
  valor_limite?: number | string
}

export interface ValidacaoPolitica {
  ok: boolean                     // true se nenhuma violação de bloqueio
  exige_aprovacao: boolean        // true se há aviso/bloqueio que precisa OK manual
  violacoes: Violacao[]
  politica_aplicada?: PoliticaCargo
}

function diasAteData(dataIso?: string): number {
  if (!dataIso) return -1
  const alvo = new Date(dataIso).getTime()
  const agora = Date.now()
  return Math.floor((alvo - agora) / (1000 * 60 * 60 * 24))
}

function inferirCargo(funcionario: Funcionario | null | undefined): Cargo | null {
  const c = funcionario?.cargo?.toLowerCase() || ''
  if (!c) return null
  if (/diretor|presidente|ceo|cfo|coo|cto|c-?level|board|conselho/.test(c)) return 'Diretor'
  if (/gerente|coord|head|lider|líder|supervisor|manager/.test(c)) return 'Gerente'
  return 'Colaborador'
}

export function validarAtendimento(args: {
  atendimento: Atendimento
  empresa?: Empresa | null
  funcionario?: Funcionario | null
  politicas: PoliticaCargo[]
}): ValidacaoPolitica {
  const { atendimento, empresa, funcionario, politicas } = args
  const violacoes: Violacao[] = []

  // 1. Identifica política aplicável
  const cargo = inferirCargo(funcionario)
  if (!cargo) {
    violacoes.push({
      codigo: 'cargo_funcionario_indefinido',
      severidade: 'aviso',
      titulo: 'Cargo do viajante não identificado',
      detalhe: 'Sem cargo definido, não é possível aplicar política. Defina o cargo no cadastro do funcionário.',
    })
  }

  const politicasEmpresa = empresa
    ? politicas.filter((p) => p.company_id === empresa.id)
    : []
  const politica = cargo
    ? politicasEmpresa.find((p) => p.cargo === cargo)
    : undefined

  if (!politica) {
    violacoes.push({
      codigo: 'sem_politica_aplicavel',
      severidade: 'aviso',
      titulo: 'Sem política configurada',
      detalhe: cargo
        ? `Empresa ${empresa?.nome || ''} não tem política para o cargo ${cargo}. Cadastre em Empresas → Políticas.`
        : 'Defina uma política para esse cargo na empresa.',
    })
    return { ok: true, exige_aprovacao: false, violacoes, politica_aplicada: undefined }
  }

  // 2. Validações de hotel
  if (atendimento.tipo_servico === 'Hotel' && atendimento.detalhes_hotel) {
    const h = atendimento.detalhes_hotel
    const diaria = h.tarifa_unitaria || 0
    if (diaria > 0 && diaria > politica.limite_diaria_hotel) {
      violacoes.push({
        codigo: 'hotel_diaria_acima_limite',
        severidade: diaria > politica.limite_diaria_hotel * 1.3 ? 'bloqueio' : 'aviso',
        titulo: 'Diária do hotel acima do limite',
        detalhe: `Limite para ${cargo}: R$ ${politica.limite_diaria_hotel.toFixed(2)}. Solicitado: R$ ${diaria.toFixed(2)}.`,
        valor_atual: diaria,
        valor_limite: politica.limite_diaria_hotel,
      })
    }

    const dias = diasAteData(h.data_checkin)
    if (dias >= 0 && dias < politica.antecedencia_hotel_dias) {
      violacoes.push({
        codigo: 'hotel_antecedencia_insuficiente',
        severidade: 'aviso',
        titulo: 'Reserva fora do prazo de antecedência',
        detalhe: `Política exige ${politica.antecedencia_hotel_dias} dia(s) de antecedência. Restam ${dias} dia(s) para o check-in.`,
        valor_atual: dias,
        valor_limite: politica.antecedencia_hotel_dias,
      })
    }
  }

  // 3. Validações aéreas
  if (atendimento.tipo_servico === 'Aéreo' && atendimento.detalhes_aereo) {
    const a = atendimento.detalhes_aereo
    const internacional = !!a.internacional
    const classeMax: ClasseAerea = internacional
      ? politica.classe_aerea_internacional || politica.classe_aerea
      : politica.classe_aerea
    const classeAtual = a.classe

    const ranking: Record<ClasseAerea, number> = {
      'Econômica': 1,
      'Econômica Premium': 2,
      'Executiva': 3,
      'Primeira': 4,
    }
    if (classeAtual && ranking[classeAtual] > ranking[classeMax]) {
      violacoes.push({
        codigo: 'aereo_classe_acima',
        severidade: 'bloqueio',
        titulo: 'Classe aérea acima da política',
        detalhe: `Política para ${cargo} (${internacional ? 'internacional' : 'doméstico'}): ${classeMax}. Solicitado: ${classeAtual}.`,
        valor_atual: classeAtual,
        valor_limite: classeMax,
      })
    }

    const valor = atendimento.valor_cotacao || atendimento.valor_venda || 0
    const limite = internacional
      ? politica.valor_maximo_aereo_internacional
      : politica.valor_maximo_aereo_domestico
    if (valor > 0 && valor > limite) {
      violacoes.push({
        codigo: internacional ? 'aereo_valor_internacional_acima' : 'aereo_valor_domestico_acima',
        severidade: valor > limite * 1.5 ? 'bloqueio' : 'aviso',
        titulo: 'Valor da passagem acima do limite',
        detalhe: `Limite ${internacional ? 'internacional' : 'doméstico'} para ${cargo}: R$ ${limite.toFixed(2)}. Solicitado: R$ ${valor.toFixed(2)}.`,
        valor_atual: valor,
        valor_limite: limite,
      })
    }

    const dias = diasAteData(a.data_ida)
    const antecedenciaMin = internacional
      ? politica.antecedencia_aereo_internacional_dias
      : politica.antecedencia_aereo_domestico_dias
    if (dias >= 0 && dias < antecedenciaMin) {
      violacoes.push({
        codigo: internacional ? 'aereo_antecedencia_insuficiente_int' : 'aereo_antecedencia_insuficiente_dom',
        severidade: 'aviso',
        titulo: 'Compra com pouca antecedência',
        detalhe: `Política exige ${antecedenciaMin} dia(s). Restam ${dias} dia(s) para a viagem.`,
        valor_atual: dias,
        valor_limite: antecedenciaMin,
      })
    }
  }

  // 4. Governança / compliance
  if (!atendimento.centro_custo) {
    violacoes.push({
      codigo: 'sem_centro_custo',
      severidade: 'aviso',
      titulo: 'Centro de custo não informado',
      detalhe: 'Toda viagem corporativa deve ter centro de custo para rateio financeiro.',
    })
  }
  if (!atendimento.autorizador_nome && !politica.aprovacao_automatica) {
    violacoes.push({
      codigo: 'sem_autorizador',
      severidade: 'aviso',
      titulo: 'Autorizador não informado',
      detalhe: 'Política exige autorização manual. Informe quem autorizou (gestor/RH).',
    })
  }

  const temBloqueio = violacoes.some((v) => v.severidade === 'bloqueio')
  const temAviso = violacoes.some((v) => v.severidade === 'aviso')

  return {
    ok: !temBloqueio,
    exige_aprovacao: temBloqueio || temAviso || !politica.aprovacao_automatica,
    violacoes,
    politica_aplicada: politica,
  }
}

export function resumoViolacoes(v: Violacao[]): string {
  if (v.length === 0) return 'Conforme política'
  const bloq = v.filter((x) => x.severidade === 'bloqueio').length
  const av = v.filter((x) => x.severidade === 'aviso').length
  if (bloq > 0) return `${bloq} bloqueio(s) + ${av} aviso(s)`
  if (av > 0) return `${av} aviso(s)`
  return 'Apenas observações'
}

export function corViolacao(s: ViolacaoSeveridade): string {
  switch (s) {
    case 'bloqueio': return 'red'
    case 'aviso': return 'amber'
    case 'info': return 'blue'
  }
}

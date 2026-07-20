'use client'
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/modal'
import { useStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth'
import { registrarLog } from '@/lib/atendimentos-storage'
import { maskCPF, onlyDigits } from '@/lib/utils'
import { encontrarFuncionarioConfiavel } from '@/lib/funcionario-identidade'
import type { Cargo, Funcionario } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  companyId: string
  companyName: string
}

interface LinhaPlanilha {
  matricula: string
  nome: string
  cpf: string
  data_nascimento: string
  centro_custo: string
  cargo_original: string
  cargo_mapeado: Cargo
  lotacao: string
  situacao: string
  telefone: string
  email: string
  aliases_nome: string[]
  valido: boolean
  erro?: string
  // raw para debug
  raw_data: any
}

function mapearCargo(cargoOriginal: string): Cargo {
  if (!cargoOriginal) return 'Colaborador'
  const c = cargoOriginal.toUpperCase()
  if (/DIRETOR|PRESIDENTE|\bVP\b|VICE.?PRESIDENTE|CEO|CFO|CTO|COO|SUPERINTENDENTE/.test(c)) return 'Diretor'
  if (/GERENTE|SUPERVISOR|COORDENADOR|CHEFE|LÍDER|LIDER|MANAGER|RESPONSAVEL TECNICO|HEAD/.test(c)) return 'Gerente'
  return 'Colaborador'
}

/** Normaliza texto removendo acentos e baixando caixa */
function norm(s: string): string {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** Pega valor por nome de coluna normalizado (sem acento, case-insensitive) */
function pegar(row: any, ...chavesAceitas: string[]): { valor: string; colunaEncontrada: string } {
  const keys = Object.keys(row)
  for (const chave of chavesAceitas) {
    const alvo = norm(chave)
    const found = keys.find((k) => norm(k) === alvo)
    if (found && row[found] != null && row[found] !== '') {
      return { valor: String(row[found]).trim(), colunaEncontrada: found }
    }
  }
  // Tenta match parcial
  for (const chave of chavesAceitas) {
    const alvo = norm(chave)
    const found = keys.find((k) => norm(k).includes(alvo) || alvo.includes(norm(k)))
    if (found && row[found] != null && row[found] !== '') {
      return { valor: String(row[found]).trim(), colunaEncontrada: found }
    }
  }
  return { valor: '', colunaEncontrada: '' }
}

/**
 * Parser de data MUITO tolerante - aceita:
 * - Date object (cellDates:true do XLSX)
 * - ISO yyyy-mm-dd ou yyyy-mm-ddTHH:mm:ss
 * - dd/mm/yyyy ou d/m/yy
 * - dd-mm-yyyy
 * - dd.mm.yyyy
 * - mm/dd/yyyy (americano - detecta se primeiro número > 12)
 * - Excel serial number (dias desde 1899-12-30)
 * - Texto com mês por extenso pt-BR
 */
function parseData(v: any): string {
  if (!v && v !== 0) return ''

  // Já é Date
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const s = String(v).trim()
  if (!s) return ''

  // ISO completo (2007-06-26 ou 2007-06-26T00:00:00)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)

  // Excel serial number puro (ex: "39624") - entre 1 e 60000 provavelmente é data Excel
  const asNum = Number(s)
  if (!isNaN(asNum) && s.indexOf('/') === -1 && s.indexOf('-') === -1 && s.indexOf('.') === -1) {
    // 25569 = 1970-01-01, 60000 ~ 2064
    if (asNum > 1 && asNum < 70000) {
      // Excel: dias desde 1899-12-30 (considera bug do ano 1900 como não-bissexto)
      const msPerDay = 86400 * 1000
      const epoch = new Date(Date.UTC(1899, 11, 30))
      const date = new Date(epoch.getTime() + asNum * msPerDay)
      if (!isNaN(date.getTime())) {
        const y = date.getUTCFullYear()
        const m = String(date.getUTCMonth() + 1).padStart(2, '0')
        const d = String(date.getUTCDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
      }
    }
  }

  // Formatos separados por /, - ou .
  const sep = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/
  const m = s.match(sep)
  if (m) {
    let [, p1, p2, p3] = m
    // Ano
    let ano = p3
    if (ano.length === 2) {
      const n = parseInt(ano)
      ano = (n > 40 ? '19' : '20') + ano
    }
    // Se p1 > 12, certamente é dia/mês/ano (pt-BR)
    // Se p2 > 12 e p1 <= 12, é mm/dd/yyyy (EN-US)
    let dia: string, mes: string
    const n1 = parseInt(p1), n2 = parseInt(p2)
    if (n1 > 12 && n2 <= 12) {
      dia = p1; mes = p2
    } else if (n2 > 12 && n1 <= 12) {
      // formato americano: assume mm/dd
      mes = p1; dia = p2
    } else {
      // ambíguo, assume pt-BR (dd/mm)
      dia = p1; mes = p2
    }
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
  }

  // Tenta Date.parse como último recurso
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear()
    if (y > 1900 && y < 2100) {
      const mo = String(parsed.getMonth() + 1).padStart(2, '0')
      const d = String(parsed.getDate()).padStart(2, '0')
      return `${y}-${mo}-${d}`
    }
  }

  return ''
}

export function ImportarFuncionariosModal({ open, onClose, companyId, companyName }: Props) {
  const { funcionarios, addFuncionario, updateFuncionario } = useStore()
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [linhas, setLinhas] = useState<LinhaPlanilha[]>([])
  const [statusFiltro, setStatusFiltro] = useState<'todos' | 'ativos'>('todos')
  const [colunasDetectadas, setColunasDetectadas] = useState<string[]>([])
  const [mapeamento, setMapeamento] = useState<Record<string, string>>({})

  function resetar() {
    setFile(null); setLinhas([]); setColunasDetectadas([]); setMapeamento({})
  }
  function fechar() { resetar(); onClose() }

  async function handleFile(f: File) {
    setFile(f); setLoading(true)
    try {
      const buffer = await f.arrayBuffer()
      // cellDates: true faz o XLSX já devolver objetos Date quando a célula é data formatada
      // raw: false força string em casos ambíguos
      const wb = XLSX.read(buffer, { cellDates: true, cellNF: false, cellText: false })

      // Escolhe primeira aba que tenha conteúdo
      let sheetName = wb.SheetNames[0]
      for (const name of wb.SheetNames) {
        const data = XLSX.utils.sheet_to_json(wb.Sheets[name])
        if (Array.isArray(data) && data.length > 0) { sheetName = name; break }
      }
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { raw: false, defval: '' }) as any[]

      if (data.length === 0) {
        toast.error('Planilha vazia.')
        return
      }

      const cols = Object.keys(data[0])
      setColunasDetectadas(cols)

      // Registra quais colunas foram usadas pra cada campo (pra debug visual)
      const mapa: Record<string, string> = {}

      const parsed: LinhaPlanilha[] = data
        .map((row, idx) => {
          const nome = pegar(row, 'Nome Func.', 'Nome do Funcionário', 'Nome', 'Funcionario', 'Funcionário', 'Colaborador', 'Empregado')
          if (idx === 0 && nome.colunaEncontrada) mapa.nome = nome.colunaEncontrada

          const cargoOriginal = pegar(row, 'Cargo', 'Função', 'Funcao', 'Cargo/Função', 'Posição')
          if (idx === 0 && cargoOriginal.colunaEncontrada) mapa.cargo = cargoOriginal.colunaEncontrada

          const matricula = pegar(row, 'Matricula', 'Matrícula', 'Matr.', 'Registro', 'ID Funcionário', 'Chapa')
          if (idx === 0 && matricula.colunaEncontrada) mapa.matricula = matricula.colunaEncontrada

          const ccCodigo = pegar(row, 'Centro De Custo', 'Centro de Custo', 'CC', 'Cod CC', 'Código CC', 'Custo')
          if (idx === 0 && ccCodigo.colunaEncontrada) mapa.centro_custo = ccCodigo.colunaEncontrada

          const ccDescricao = pegar(row, 'Descrição CC', 'Descricao CC', 'Descrição Centro de Custo', 'Nome CC', 'Descrição')

          const lotacao = pegar(row, 'Lotação', 'Lotacao', 'Setor', 'Departamento', 'Unidade', 'Area')
          if (idx === 0 && lotacao.colunaEncontrada) mapa.lotacao = lotacao.colunaEncontrada

          const situacao = pegar(row, 'Situação Atual', 'Situacao Atual', 'Situacao', 'Status', 'Situação')

          const cpfRaw = pegar(row, 'CPF', 'Cpf', 'C.P.F.', 'Documento', 'CPF/MF')
          if (idx === 0 && cpfRaw.colunaEncontrada) mapa.cpf = cpfRaw.colunaEncontrada

          // DATA NASCIMENTO: muitas variações possíveis
          const dataNascRaw = pegar(row,
            'Dt Nascimento', 'Dt. Nascimento', 'Dt.Nascimento',
            'Data de Nascimento', 'Data Nascimento', 'Data Nasc.', 'Dt Nasc.',
            'Nascimento', 'Dt. Nasc.', 'Data Nasc', 'Dt Nasc', 'Dt.Nasc',
            'Dt nascto', 'Dt. Nascto', 'Data Nascto', 'Dt. Nasc',
            'Birthdate', 'Birth Date', 'DOB'
          )
          if (idx === 0 && dataNascRaw.colunaEncontrada) mapa.data_nascimento = dataNascRaw.colunaEncontrada

          const telefone = pegar(row, 'Telefone', 'Fone', 'Celular', 'Contato', 'Tel', 'Telefone Celular')
          if (idx === 0 && telefone.colunaEncontrada) mapa.telefone = telefone.colunaEncontrada

          const email = pegar(row, 'E-mail', 'Email', 'Endereço Eletrônico')
          if (idx === 0 && email.colunaEncontrada) mapa.email = email.colunaEncontrada

          const aliases = pegar(row, 'Aliases', 'Alias', 'Nomes Alternativos', 'Nome Wintour', 'Nome Relatorio', 'Nome Relatório', 'Nome Aereo', 'Nome Aéreo', 'Nome Hotel')
          if (idx === 0 && aliases.colunaEncontrada) mapa.aliases = aliases.colunaEncontrada

          // Processa valores
          const centro_custo = ccDescricao.valor
            ? `${ccCodigo.valor} - ${ccDescricao.valor}`.trim().replace(/^-\s*/, '')
            : ccCodigo.valor

          // Busca o valor original da célula de data (não a string processada) se disponível
          let dataFormatada = ''
          if (dataNascRaw.colunaEncontrada) {
            const rawCell = row[dataNascRaw.colunaEncontrada]
            dataFormatada = parseData(rawCell)
          }

          const cpfLimpo = onlyDigits(cpfRaw.valor)
          const cpfValido = !cpfRaw.valor || cpfLimpo.length === 11

          const valido = !!nome.valor
          const erro = !nome.valor ? 'Nome em branco' : !cpfValido ? 'CPF inválido' : undefined

          return {
            matricula: matricula.valor,
            nome: nome.valor,
            cpf: cpfLimpo,
            data_nascimento: dataFormatada,
            cargo_original: cargoOriginal.valor,
            cargo_mapeado: mapearCargo(cargoOriginal.valor),
            centro_custo,
            lotacao: lotacao.valor,
            situacao: situacao.valor,
            telefone: onlyDigits(telefone.valor),
            email: email.valor,
            aliases_nome: aliases.valor.split(/\r?\n|;|\|/).map((item) => item.trim()).filter(Boolean),
            valido,
            erro,
            raw_data: {
              data_nasc_raw: dataNascRaw.colunaEncontrada ? row[dataNascRaw.colunaEncontrada] : undefined,
              data_nasc_tipo: dataNascRaw.colunaEncontrada ? typeof row[dataNascRaw.colunaEncontrada] : 'ausente',
            },
          }
        })
        .filter((l) => l.nome)

      setMapeamento(mapa)
      setLinhas(parsed)

      const comNasc = parsed.filter((l) => l.data_nascimento).length
      toast.success(`${parsed.length} funcionário(s) encontrado(s)${comNasc > 0 ? ` · ${comNasc} com data de nascimento` : ''}`)
    } catch (err: any) {
      console.error(err)
      toast.error('Erro ao ler planilha: ' + (err?.message || 'formato inválido'))
    } finally {
      setLoading(false)
    }
  }

  function mudarCargo(index: number, novoCargo: Cargo) {
    setLinhas((prev) => prev.map((l, i) => (i === index ? { ...l, cargo_mapeado: novoCargo } : l)))
  }

  function confirmar() {
    const paraImportar = statusFiltro === 'ativos'
      ? linhas.filter((l) => !l.situacao || /atividade|ativo|normal/i.test(l.situacao))
      : linhas

    if (paraImportar.length === 0) {
      toast.error('Nenhum funcionário a importar após os filtros.')
      return
    }

    let importados = 0, atualizados = 0, comCpf = 0, comNasc = 0
    const baseAtual = [...funcionarios]
    paraImportar.forEach((l) => {
      const novoFunc: Omit<Funcionario, 'id' | 'created_at'> = {
        company_id: companyId,
        nome: l.nome,
        cpf: l.cpf,
        data_nascimento: l.data_nascimento,
        telefone: l.telefone,
        email: l.email,
        passaporte: '',
        passaporte_validade: '',
        milhagem: '',
        preferencias: '',
        cargo: l.cargo_mapeado,
        cargo_original: l.cargo_original,
        centro_custo: l.centro_custo,
        matricula: l.matricula,
        lotacao: l.lotacao,
        aliases_nome: l.aliases_nome,
        ativo: true,
      }
      const existente = encontrarFuncionarioConfiavel(baseAtual, novoFunc, companyId)
      if (existente) {
        const patch: Partial<Funcionario> = {
          nome: l.nome || existente.nome,
          cpf: l.cpf || existente.cpf,
          data_nascimento: l.data_nascimento || existente.data_nascimento,
          telefone: l.telefone || existente.telefone,
          email: l.email || existente.email,
          cargo: l.cargo_mapeado || existente.cargo,
          cargo_original: l.cargo_original || existente.cargo_original,
          centro_custo: l.centro_custo || existente.centro_custo,
          matricula: l.matricula || existente.matricula,
          lotacao: l.lotacao || existente.lotacao,
          aliases_nome: Array.from(new Set([...(existente.aliases_nome || []), ...l.aliases_nome])),
          ativo: true,
        }
        updateFuncionario(existente.id, patch)
        Object.assign(existente, patch)
        atualizados++
      } else {
        const criado = addFuncionario(novoFunc)
        if (criado) {
          baseAtual.push(criado)
          importados++
        }
      }
      if (l.cpf) comCpf++
      if (l.data_nascimento) comNasc++
    })

    const user = getCurrentUser()
    if (user) {
      registrarLog({
        user_id: user.id, user_name: user.name, acao: 'importar',
        entidade: 'Funcionarios', entidade_id: companyId,
        descricao: `Importou ${importados} funcionário(s) e atualizou ${atualizados} para ${companyName}. Arquivo: ${file?.name || '?'}. Com CPF: ${comCpf}. Com nasc.: ${comNasc}.`,
      })
    }

    toast.success(`${importados} importados, ${atualizados} atualizados. (${comCpf} com CPF, ${comNasc} com data nasc.)`, { duration: 5000 })
    fechar()
  }

  const contagemCargos = {
    Diretor: linhas.filter((l) => l.cargo_mapeado === 'Diretor').length,
    Gerente: linhas.filter((l) => l.cargo_mapeado === 'Gerente').length,
    Colaborador: linhas.filter((l) => l.cargo_mapeado === 'Colaborador').length,
  }
  const totalAtivos = linhas.filter((l) => !l.situacao || /atividade|ativo|normal/i.test(l.situacao)).length
  const comCpf = linhas.filter((l) => l.cpf).length
  const comNasc = linhas.filter((l) => l.data_nascimento).length

  return (
    <Modal open={open} onClose={fechar} title={`Importar funcionários para ${companyName}`} size="xl">
      {linhas.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Envie a planilha. O sistema reconhece automaticamente (em qualquer ordem, com ou sem acentos):
          </p>
          <div className="text-xs grid grid-cols-2 md:grid-cols-3 gap-2 bg-bbt-gray-50 dark:bg-slate-900/40 p-3 rounded-lg">
            <div>✓ Nome Func. / Nome</div>
            <div>✓ CPF</div>
            <div>✓ Dt Nascimento / Nascimento</div>
            <div>✓ Matrícula / Chapa</div>
            <div>✓ Centro De Custo</div>
            <div>✓ Descrição CC</div>
            <div>✓ Cargo / Função</div>
            <div>✓ Lotação / Setor</div>
            <div>✓ Situação Atual</div>
            <div>✓ Telefone / Celular</div>
            <div>✓ E-mail</div>
          </div>
          <label className="block border-2 border-dashed border-bbt-gray-100 dark:border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-bbt-accent hover:bg-bbt-accent/5 transition">
            <FileSpreadsheet className="w-10 h-10 mx-auto text-bbt-accent mb-3" />
            <p className="font-medium text-bbt-primary dark:text-white">{loading ? 'Processando...' : 'Clique para selecionar a planilha'}</p>
            <p className="text-xs text-slate-500 mt-1">.xlsx ou .xls</p>
            <input type="file" accept=".xlsx,.xls" disabled={loading} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
          </label>
          <div className="text-xs text-slate-500 bg-blue-50 dark:bg-slate-800/60 border border-blue-100 dark:border-slate-700 rounded-lg p-3">
            <strong>🧠 Parsing de data avançado:</strong> Reconhece formatos dd/mm/yyyy, yyyy-mm-dd, mm/dd/yyyy, número serial Excel (39624), Date objects, e ainda corrige anos de 2 dígitos.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Mapeamento detectado */}
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-3 text-xs">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-semibold mb-2">
              <CheckCircle className="w-4 h-4" /> Mapeamento automático detectado
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-green-700 dark:text-green-300">
              {mapeamento.nome && <div><span className="font-mono opacity-70">Nome:</span> <strong>{mapeamento.nome}</strong></div>}
              {mapeamento.cpf && <div><span className="font-mono opacity-70">CPF:</span> <strong>{mapeamento.cpf}</strong></div>}
              {mapeamento.data_nascimento
                ? <div><span className="font-mono opacity-70">Nascimento:</span> <strong>{mapeamento.data_nascimento}</strong></div>
                : <div className="text-amber-700 dark:text-amber-300"><span className="font-mono opacity-70">Nascimento:</span> <em>coluna não encontrada</em></div>
              }
              {mapeamento.matricula && <div><span className="font-mono opacity-70">Matrícula:</span> <strong>{mapeamento.matricula}</strong></div>}
              {mapeamento.centro_custo && <div><span className="font-mono opacity-70">Centro de custo:</span> <strong>{mapeamento.centro_custo}</strong></div>}
              {mapeamento.cargo && <div><span className="font-mono opacity-70">Cargo:</span> <strong>{mapeamento.cargo}</strong></div>}
              {mapeamento.lotacao && <div><span className="font-mono opacity-70">Lotação:</span> <strong>{mapeamento.lotacao}</strong></div>}
              {mapeamento.telefone && <div><span className="font-mono opacity-70">Telefone:</span> <strong>{mapeamento.telefone}</strong></div>}
              {mapeamento.email && <div><span className="font-mono opacity-70">E-mail:</span> <strong>{mapeamento.email}</strong></div>}
            </div>
            {colunasDetectadas.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer opacity-70 hover:opacity-100">Ver todas as {colunasDetectadas.length} colunas detectadas</summary>
                <div className="mt-1 text-[10px] opacity-75">{colunasDetectadas.join(' · ')}</div>
              </details>
            )}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <Stat label="Total" value={linhas.length} />
            <Stat label="Com CPF" value={comCpf} color={comCpf > 0 ? 'green' : 'slate'} />
            <Stat label={<><Calendar className="inline w-3 h-3 mr-0.5" />Com nasc.</>} value={comNasc} color={comNasc > 0 ? 'green' : 'amber'} />
            <Stat label="Diretores" value={contagemCargos.Diretor} color="purple" />
            <Stat label="Gerentes" value={contagemCargos.Gerente} color="blue" />
            <Stat label="Colab." value={contagemCargos.Colaborador} color="green" />
          </div>

          <div className="flex items-center gap-4 text-sm flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={statusFiltro === 'todos'} onChange={() => setStatusFiltro('todos')} />
              <span>Todos ({linhas.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={statusFiltro === 'ativos'} onChange={() => setStatusFiltro('ativos')} />
              <span>Apenas ativos ({totalAtivos})</span>
            </label>
          </div>

          <div>
            <h4 className="font-medium text-sm text-bbt-primary dark:text-white mb-2">Preview — primeiras 15 linhas</h4>
            <div className="border border-bbt-gray-100 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="max-h-[340px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-bbt-gray-50 dark:bg-slate-900/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold">Nome</th>
                      <th className="px-2 py-2 text-left font-semibold">CPF</th>
                      <th className="px-2 py-2 text-left font-semibold">Nasc.</th>
                      <th className="px-2 py-2 text-left font-semibold">Cargo Original</th>
                      <th className="px-2 py-2 text-left font-semibold">→ Mapeado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.slice(0, 15).map((l, i) => (
                      <tr key={i} className="border-t border-bbt-gray-100 dark:border-slate-700">
                        <td className="px-2 py-1.5 font-medium truncate max-w-[180px]">{l.nome}</td>
                        <td className="px-2 py-1.5 text-slate-500 font-mono text-[10px]">{l.cpf ? maskCPF(l.cpf) : '—'}</td>
                        <td className={`px-2 py-1.5 font-mono text-[10px] ${l.data_nascimento ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-slate-300'}`}>
                          {l.data_nascimento || '—'}
                        </td>
                        <td className="px-2 py-1.5 truncate max-w-[180px]">{l.cargo_original || '—'}</td>
                        <td className="px-2 py-1.5">
                          <select value={l.cargo_mapeado} onChange={(e) => mudarCargo(i, e.target.value as Cargo)}
                            className={`text-xs font-semibold rounded px-1.5 py-0.5 border-0 cursor-pointer ${
                              l.cargo_mapeado === 'Diretor' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                              : l.cargo_mapeado === 'Gerente' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                              : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            }`}>
                            <option>Diretor</option><option>Gerente</option><option>Colaborador</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {linhas.length > 15 && (
                <div className="p-2 bg-bbt-gray-50 dark:bg-slate-900/40 text-xs text-center text-slate-500">
                  ... e mais {linhas.length - 15} funcionário(s)
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
            <button onClick={resetar} className="bbt-button-ghost text-sm">Trocar arquivo</button>
            <div className="flex gap-2">
              <button onClick={fechar} className="bbt-button-ghost">Cancelar</button>
              <button onClick={confirmar} className="bbt-button-primary flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Importar {statusFiltro === 'ativos' ? totalAtivos : linhas.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Stat({ label, value, color = 'slate' }: { label: React.ReactNode; value: number; color?: string }) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  }
  return (
    <div className={`rounded-lg p-3 text-center ${colors[color]}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
    </div>
  )
}

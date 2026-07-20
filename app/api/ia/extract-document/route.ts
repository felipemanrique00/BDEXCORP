import { NextRequest, NextResponse } from 'next/server'
import { callGemini, callOpenAIResponses, extractJSON, getPaidAIStatus } from '@/lib/server-ai'
import { guardApiRequest } from '@/lib/security/api-guard'
import { classifyAIError } from '@/lib/ai-friendly-errors'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BASE64 = 45 * 1024 * 1024
const MAX_REQUEST_BYTES = 48 * 1024 * 1024

type DocumentKind = 'image' | 'pdf'

interface ExtractDocumentBody {
  kind?: DocumentKind
  fileName?: string
  mimeType?: string
  base64?: string
}

const PROMPT = `Voce e um OCR conferente de documentos brasileiros para cadastro de funcionario em agencia de viagens corporativas.
Extraia somente dados que estejam legiveis no documento. Nao invente.

Documentos comuns: RG, CNH, CPF, passaporte.

Retorne APENAS JSON valido, sem markdown:
{
  "documento_tipo": "RG" | "CNH" | "CPF" | "PASSAPORTE" | "OUTRO" | null,
  "nome": string | null,
  "cpf": string | null,
  "rg": string | null,
  "documento_numero": string | null,
  "data_nascimento": "YYYY-MM-DD" | null,
  "nome_mae": string | null,
  "nome_pai": string | null,
  "naturalidade": string | null,
  "nacionalidade": string | null,
  "orgao_emissor": string | null,
  "uf_emissor": string | null,
  "data_emissao": "YYYY-MM-DD" | null,
  "documento_validade": "YYYY-MM-DD" | null,
  "cnh_registro": string | null,
  "cnh_categoria": string | null,
  "primeira_habilitacao": "YYYY-MM-DD" | null,
  "campos_confianca": {
    "nome": "alta" | "media" | "baixa" | null,
    "cpf": "alta" | "media" | "baixa" | null,
    "rg": "alta" | "media" | "baixa" | null,
    "data_nascimento": "alta" | "media" | "baixa" | null
  },
  "texto_lido": string,
  "avisos": string[],
  "precisa_revisao": boolean
}

Regras obrigatorias:
- CPF deve sair somente com 11 digitos. Se estiver incompleto ou duvidoso, retorne null e adicione aviso.
- Datas sempre em YYYY-MM-DD.
- Se houver frente e verso no PDF, cruze os dados das paginas.
- Se a foto estiver girada, leia mesmo assim.
- Nao confunda numero de registro da CNH com CPF.
- Nome deve ser o nome civil completo do titular, nao filiacao.
- Documento escaneado/foto sempre precisa revisao se qualquer campo essencial estiver ilegivel.`

export async function POST(req: NextRequest) {
  const guard = guardApiRequest(req, {
    requireAuth: true,
    rateLimit: { key: 'ia-extract-document', limit: 12, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  let body: ExtractDocumentBody
  try {
    body = await readJsonBody<ExtractDocumentBody>(req, MAX_REQUEST_BYTES)
  } catch (error) {
    const inputError = requestBodyErrorResponse(error)
    return NextResponse.json({ error: inputError?.message || 'JSON invalido' }, { status: inputError?.status || 400 })
  }

  const base64 = stripDataUrl(body.base64 || '')
  if (!base64) return NextResponse.json({ error: 'Envie PDF ou imagem do documento.' }, { status: 400 })
  if (base64.length > MAX_BASE64) {
    return NextResponse.json({ error: 'Arquivo grande demais. Use PDF/imagem ate 35 MB.' }, { status: 413 })
  }

  const mimeType = normalizeMime(body.mimeType, body.fileName, body.kind)
  const kind: DocumentKind = mimeType === 'application/pdf' ? 'pdf' : 'image'
  const status = getPaidAIStatus()

  if (status.provedor === 'openai') {
    try {
      const content =
        kind === 'pdf'
          ? [
              {
                type: 'input_file',
                filename: body.fileName || 'documento.pdf',
                file_data: `data:application/pdf;base64,${base64}`,
              },
              { type: 'input_text', text: PROMPT },
            ]
          : [
              { type: 'input_image', image_url: `data:${mimeType};base64,${base64}` },
              { type: 'input_text', text: PROMPT },
            ]

      const data = await callOpenAIResponses({
        input: [{ role: 'user', content }],
        model: process.env.OPENAI_MODEL || 'gpt-5.2',
        maxOutputTokens: 2200,
        reasoningEffort: 'medium',
      })
      const parsed = JSON.parse(extractJSON(data.output_text || ''))
      return NextResponse.json({
        ...normalizarDocumento(parsed),
        ia_usado: true,
        provedor: 'openai',
        modelo: data.model,
        usage: data.usage,
      })
    } catch (e: any) {
      if (process.env.GEMINI_API_KEY) {
        try {
          return await extractWithGemini({ base64, mimeType, fileName: body.fileName })
        } catch {}
      }
      const friendly = classifyAIError(e, 'openai')
      return NextResponse.json(
        {
          error: friendly.message,
          code: friendly.kind,
          provedor: 'openai',
        },
        { status: e.status || 500 },
      )
    }
  }

  if (status.provedor === 'gemini') {
    try {
      return await extractWithGemini({ base64, mimeType, fileName: body.fileName })
    } catch (e: any) {
      const friendly = classifyAIError(e, 'gemini')
      return NextResponse.json(
        {
          error: friendly.message,
          code: friendly.kind,
          provedor: 'gemini',
        },
        { status: e.status || 500 },
      )
    }
  }

  return NextResponse.json(
    {
      error:
        'A leitura precisa de IA premium com visao/PDF ativa. Configure OPENAI_API_KEY no servidor; GEMINI_API_KEY pode atuar como fallback.',
      code: 'not_configured',
      provedor: 'local',
    },
    { status: 503 },
  )
}

async function extractWithGemini({ base64, mimeType, fileName }: { base64: string; mimeType: string; fileName?: string }) {
  const data = await callGemini({
    parts: [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: [PROMPT, fileName ? `Arquivo: ${fileName}` : ''].filter(Boolean).join('\n') },
    ],
    maxOutputTokens: 2200,
  })
  const parsed = JSON.parse(extractJSON(data.content?.[0]?.text || ''))
  return NextResponse.json({
    ...normalizarDocumento(parsed),
    ia_usado: true,
    provedor: 'gemini',
    modelo: data.model,
    usage: data.usage,
  })
}

function normalizarDocumento(value: any) {
  const avisos = Array.isArray(value?.avisos) ? value.avisos.map(String) : []
  const cpf = onlyDigits(value?.cpf)
  const cpfOk = cpf ? cpfValido(cpf) : false
  const documentoTipo = normalizarTipo(value?.documento_tipo, value)
  const rgRaw = documentoTipo === 'CNH' ? value?.rg : value?.rg || value?.documento_numero
  const rg = String(rgRaw || '').replace(/[^\dA-Za-z.-]/g, '').trim()

  if (cpf && !cpfOk) avisos.push('CPF lido nao passou na validacao matematica e nao foi preenchido automaticamente.')
  if (!cpf) avisos.push('CPF nao foi identificado com seguranca.')
  if (!value?.nome) avisos.push('Nome nao foi identificado com seguranca.')

  const result = {
    documento_tipo: documentoTipo,
    nome: limparNome(value?.nome),
    cpf: cpfOk ? cpf : null,
    rg: rg || null,
    documento_numero: String(value?.documento_numero || rg || '').trim() || null,
    data_nascimento: normalizarData(value?.data_nascimento),
    nome_mae: limparNome(value?.nome_mae),
    nome_pai: limparNome(value?.nome_pai),
    naturalidade: limparTexto(value?.naturalidade),
    nacionalidade: limparTexto(value?.nacionalidade),
    orgao_emissor: limparTexto(value?.orgao_emissor),
    uf_emissor: limparUF(value?.uf_emissor),
    data_emissao: normalizarData(value?.data_emissao),
    documento_validade: normalizarData(value?.documento_validade),
    cnh_registro: onlyDigits(value?.cnh_registro) || null,
    cnh_categoria: limparTexto(value?.cnh_categoria),
    primeira_habilitacao: normalizarData(value?.primeira_habilitacao),
    campos_confianca: value?.campos_confianca || {},
    texto_lido: String(value?.texto_lido || '').slice(0, 3000),
    avisos: Array.from(new Set(avisos)),
    precisa_revisao: Boolean(value?.precisa_revisao || avisos.length > 0),
  }

  return result
}

function normalizarTipo(tipo: any, value: any): string | null {
  const raw = String(tipo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  if (raw.includes('CNH') || value?.cnh_registro || value?.primeira_habilitacao || value?.cnh_categoria) return 'CNH'
  if (raw.includes('RG') || raw.includes('IDENTIDADE')) return 'RG'
  if (raw.includes('CPF')) return 'CPF'
  if (raw.includes('PASSAPORTE')) return 'PASSAPORTE'
  return raw ? 'OUTRO' : null
}

function normalizarData(value: any): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const iso = raw.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/)?.[0]
  if (iso) return iso
  const br = raw.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)
  if (!br) return null
  let ano = Number(br[3])
  if (ano < 100) ano += ano > 50 ? 1900 : 2000
  return `${ano}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
}

function limparNome(value: any): string | null {
  const text = limparTexto(value)
  if (!text) return null
  return text.replace(/\s+/g, ' ').trim()
}

function limparTexto(value: any): string | null {
  const text = String(value || '').trim()
  return text ? text : null
}

function limparUF(value: any): string | null {
  const uf = String(value || '').replace(/[^A-Za-z]/g, '').toUpperCase()
  return uf.length === 2 ? uf : null
}

function onlyDigits(value: any): string {
  return String(value || '').replace(/\D/g, '')
}

function cpfValido(value: string): boolean {
  const cpf = onlyDigits(value)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const calc = (slice: string, factor: number) => {
    let total = 0
    for (const digit of slice) total += Number(digit) * factor--
    const rest = (total * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return calc(cpf.slice(0, 9), 10) === Number(cpf[9]) && calc(cpf.slice(0, 10), 11) === Number(cpf[10])
}

function stripDataUrl(value: string): string {
  const comma = value.indexOf(',')
  return comma >= 0 ? value.slice(comma + 1) : value
}

function normalizeMime(mime?: string, fileName?: string, kind?: DocumentKind): string {
  if (mime && mime !== 'application/octet-stream') return mime
  const name = (fileName || '').toLowerCase()
  if (name.endsWith('.pdf') || kind === 'pdf') return 'application/pdf'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

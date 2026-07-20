import { NextRequest, NextResponse } from 'next/server'
import {
  callGemini,
  callOpenAIResponses,
  extractJSON,
  getPaidAIStatus,
  localExtraction,
  transcribeAudioWithOpenAI,
} from '@/lib/server-ai'
import { guardApiRequest } from '@/lib/security/api-guard'
import { classifyAIError } from '@/lib/ai-friendly-errors'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_INLINE_BASE64 = 28 * 1024 * 1024
const MAX_REQUEST_BYTES = 30 * 1024 * 1024

type ExtractKind = 'text' | 'email' | 'image' | 'audio'

interface ExtractDemandBody {
  kind?: ExtractKind
  text?: string
  fileName?: string
  mimeType?: string
  base64?: string
}

const EXTRACTION_PROMPT = `Voce e o motor premium de leitura de demandas da BBT Viagens Corporativas.
Extraia dados de pedidos recebidos por WhatsApp, e-mail, Outlook, print, PDF ou audio.

Retorne APENAS JSON valido, sem markdown:
{
  "transcricao": "texto transcrito quando houver audio; se nao houver audio, texto principal limpo",
  "tipo_servico": "Hotel" | "Aereo" | "Carro" | "Pacote" | "Outro" | null,
  "passageiro_nome": string | null,
  "passageiros_lista": string[] | null,
  "empresa_nome": string | null,
  "empresa_faturar": string | null,
  "centro_custo": string | null,
  "solicitante_nome": string | null,
  "solicitante_email": string | null,
  "cpf": string | null,
  "telefone": string | null,
  "hotel_nome": string | null,
  "tipo_quarto": "SGL" | "DBL" | "TPL" | null,
  "valor_diaria": number | null,
  "cafe_manha": boolean | null,
  "cidade_destino": string | null,
  "cidade_origem": string | null,
  "data_checkin": "YYYY-MM-DD" | null,
  "data_checkout": "YYYY-MM-DD" | null,
  "data_ida": "YYYY-MM-DD" | null,
  "data_volta": "YYYY-MM-DD" | null,
  "num_hospedes": number | null,
  "urgente": boolean,
  "ia_confianca": "alta" | "media" | "baixa",
  "ia_resumo": "resumo operacional de 1 frase"
}

Regras:
- Datas sempre em YYYY-MM-DD.
- Se falar "15/08" sem ano, use o ano atual ou o proximo se a data ja passou.
- Ignore assinaturas, disclaimers e historico antigo de e-mail.
- Se vier somente um nome de pessoa, trate como passageiro_nome e retorne ia_confianca "baixa".
- "PAX" pode ser quantidade ou nome do passageiro; se nao for numero, extraia como passageiro.
- E-mails do Outlook podem vir como tabela; relacione cabecalhos e valores mesmo quando estiverem em linhas/colunas separadas.
- Nao invente CPF, telefone, empresa, hotel, cidade ou valor. Use null se nao apareceu.`

export async function POST(req: NextRequest) {
  const guard = guardApiRequest(req, {
    requireAuth: true,
    rateLimit: { key: 'ia-extract-demand', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  let body: ExtractDemandBody
  try {
    body = await readJsonBody<ExtractDemandBody>(req, MAX_REQUEST_BYTES)
  } catch (error) {
    const inputError = requestBodyErrorResponse(error)
    return NextResponse.json({ error: inputError?.message || 'JSON invalido' }, { status: inputError?.status || 400 })
  }

  const kind = body.kind || 'text'
  const text = (body.text || '').trim()
  const base64 = stripDataUrl(body.base64 || '')
  const mimeType = normalizeMime(body.mimeType, body.fileName, kind)

  if (!text && !base64) {
    return NextResponse.json({ error: 'Envie texto, imagem ou audio.' }, { status: 400 })
  }
  if (text.length > 100_000) {
    return NextResponse.json({ error: 'Texto grande demais. Divida o conteudo antes de enviar.' }, { status: 413 })
  }
  if (base64.length > MAX_INLINE_BASE64) {
    return NextResponse.json(
      { error: 'Arquivo grande demais para envio direto. Use ate 20 MB ou divida o audio.' },
      { status: 413 },
    )
  }

  const status = getPaidAIStatus()

  if (status.provedor === 'openai') {
    try {
      let transcricao = text
      if (kind === 'audio') {
        transcricao = await transcribeAudioWithOpenAI({
          base64,
          fileName: body.fileName,
          mimeType,
          prompt: 'Audio de demanda corporativa de viagem em portugues do Brasil. Extraia nomes, cidades, datas, hotel, empresa e urgencia.',
        })
      }

      const content: any[] = [
        {
          type: 'input_text',
          text: [
            EXTRACTION_PROMPT,
            '',
            `Tipo de entrada: ${kind}`,
            body.fileName ? `Arquivo: ${body.fileName}` : '',
            `Ano atual: ${new Date().getFullYear()}`,
            transcricao ? `Texto/transcricao:\n${transcricao.slice(0, 9000)}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ]

      if (kind === 'image' && base64) {
        content.unshift({
          type: 'input_image',
          image_url: `data:${mimeType};base64,${base64}`,
        })
      }

      const data = await callOpenAIResponses({
        input: [{ role: 'user', content }],
        model: process.env.OPENAI_MODEL || 'gpt-5.2',
        maxOutputTokens: 1800,
        reasoningEffort: 'low',
      })

      const parsed = JSON.parse(extractJSON(data.output_text || ''))
      return NextResponse.json({
        ...normalizarTipoServico(parsed),
        transcricao: parsed.transcricao || transcricao,
        ia_usado: true,
        modo: 'estruturado',
        provedor: 'openai',
        modelo: data.model,
        sources: data.sources,
        usage: data.usage,
      })
    } catch (e: any) {
      if (process.env.GEMINI_API_KEY) {
        try {
          return await extractWithGemini({ kind, text, base64, mimeType, fileName: body.fileName })
        } catch {}
      }
      if (kind === 'text' || kind === 'email') {
        const friendly = classifyAIError(e, 'openai')
        return NextResponse.json({
          ...localExtraction(text),
          ia_erro: friendly.message,
          ia_indisponivel: true,
          provedor: 'local',
        })
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
      return await extractWithGemini({ kind, text, base64, mimeType, fileName: body.fileName })
    } catch (e: any) {
      if (kind === 'text' || kind === 'email') {
        const friendly = classifyAIError(e, 'gemini')
        return NextResponse.json({
          ...localExtraction(text),
          ia_erro: friendly.message,
          ia_indisponivel: true,
          provedor: 'local',
        })
      }
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

  if (kind === 'audio' || kind === 'image') {
    return NextResponse.json(
      {
        error:
          'A leitura de audio e imagem precisa da IA premium conectada. Configure OPENAI_API_KEY no servidor; GEMINI_API_KEY pode atuar como apoio.',
        code: 'not_configured',
        provedor: 'local',
      },
      { status: 503 },
    )
  }

  return NextResponse.json(localExtraction(text))
}

async function extractWithGemini({
  kind,
  text,
  base64,
  mimeType,
  fileName,
}: {
  kind: ExtractKind
  text: string
  base64: string
  mimeType: string
  fileName?: string
}) {
  const parts: any[] = []
  if (base64) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: base64,
      },
    })
  }
  parts.push({
    text: [
      EXTRACTION_PROMPT,
      '',
      `Tipo de entrada: ${kind}`,
      fileName ? `Arquivo: ${fileName}` : '',
      `Ano atual: ${new Date().getFullYear()}`,
      text ? `Texto complementar:\n${text.slice(0, 7000)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  })
  const data = await callGemini({ parts, maxOutputTokens: 1800 })
  const parsed = JSON.parse(extractJSON(data.content?.[0]?.text || ''))
  return NextResponse.json({
    ...normalizarTipoServico(parsed),
    ia_usado: true,
    modo: 'estruturado',
    provedor: 'gemini',
    modelo: data.model,
    sources: data.sources,
    usage: data.usage,
  })
}

function stripDataUrl(value: string): string {
  const comma = value.indexOf(',')
  return comma >= 0 ? value.slice(comma + 1) : value
}

function normalizeMime(mime?: string, fileName?: string, kind?: ExtractKind): string {
  if (mime && mime !== 'application/octet-stream') return mime
  const name = (fileName || '').toLowerCase()
  if (name.endsWith('.opus')) return 'audio/ogg'
  if (name.endsWith('.ogg')) return 'audio/ogg'
  if (name.endsWith('.m4a')) return 'audio/mp4'
  if (name.endsWith('.mp3')) return 'audio/mpeg'
  if (name.endsWith('.wav')) return 'audio/wav'
  if (name.endsWith('.webm')) return 'audio/webm'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.png')) return 'image/png'
  if (kind === 'audio') return 'audio/mpeg'
  if (kind === 'image') return 'image/png'
  return 'text/plain'
}

function normalizarTipoServico(value: any) {
  const tipo = String(value?.tipo_servico || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  if (tipo === 'aereo') value.tipo_servico = 'Aéreo'
  else if (tipo === 'hotel') value.tipo_servico = 'Hotel'
  else if (tipo === 'carro' || tipo === 'locacao') value.tipo_servico = 'Carro'
  else if (tipo === 'pacote') value.tipo_servico = 'Pacote'
  else if (tipo === 'outro') value.tipo_servico = 'Outro'
  else value.tipo_servico = undefined

  return value
}

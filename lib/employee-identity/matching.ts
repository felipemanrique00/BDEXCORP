import {
  compararNomeFuncionario,
  normalizarCodigoIdentificacao,
  normalizarDocumento,
  normalizarEmail,
  normalizarTextoIdentidade,
} from '@/lib/funcionario-identidade'

export interface EmployeeIdentityCandidate {
  id: string
  companyId: string
  identificationCode: string
  fullName: string
  documentNumber: string | null
  email: string | null
  registrationCode: string | null
  aliases: string[]
}

export interface EmployeeIdentityHints {
  employeeId?: string | null
  identificationCode?: unknown
  documentNumber?: unknown
  email?: unknown
  registrationCode?: unknown
  name?: unknown
}

export interface EmployeeIdentityResolution {
  employeeId: string | null
  status: 'exact' | 'alias' | 'automatic' | 'manual' | 'ambiguous' | 'unresolved'
  confidence: number | null
  method: string
  candidates: Array<{
    employeeId: string
    identificationCode: string
    fullName: string
    score: number
    reason: string
  }>
}

export function resolveEmployeeIdentity(
  candidates: EmployeeIdentityCandidate[],
  companyId: string,
  hints: EmployeeIdentityHints,
  minimumNameScore = 84,
  ambiguityMargin = 8,
): EmployeeIdentityResolution {
  const scoped = candidates.filter((candidate) => candidate.companyId === companyId)
  const explicit = hints.employeeId
    ? scoped.find((candidate) => candidate.id === hints.employeeId)
    : null
  if (explicit) return resolved(explicit, 'exact', 1, 'employee_id')

  const reliableMatchers: Array<{
    method: string
    expected: string
    value: (candidate: EmployeeIdentityCandidate) => string
  }> = [
    {
      method: 'identification_code',
      expected: normalizarCodigoIdentificacao(hints.identificationCode),
      value: (candidate) => normalizarCodigoIdentificacao(candidate.identificationCode),
    },
    {
      method: 'document',
      expected: normalizarDocumento(hints.documentNumber),
      value: (candidate) => normalizarDocumento(candidate.documentNumber),
    },
    {
      method: 'email',
      expected: normalizarEmail(hints.email),
      value: (candidate) => normalizarEmail(candidate.email),
    },
    {
      method: 'registration_code',
      expected: normalizarTextoIdentidade(hints.registrationCode),
      value: (candidate) => normalizarTextoIdentidade(candidate.registrationCode),
    },
  ]

  for (const matcher of reliableMatchers) {
    if (!matcher.expected) continue
    if (matcher.method === 'document' && matcher.expected.length < 5) continue
    const matches = scoped.filter((candidate) => matcher.value(candidate) === matcher.expected)
    if (matches.length === 1) return resolved(matches[0], 'exact', 1, matcher.method)
    if (matches.length > 1) {
      return unresolved('ambiguous', matcher.method, matches.map((candidate) => evidence(candidate, 100, matcher.method)))
    }
  }

  const ranked = scoped
    .map((candidate) => {
      const match = compararNomeFuncionario(hints.name, {
        nome: candidate.fullName,
        aliases_nome: candidate.aliases,
      })
      return { candidate, score: match.score, reason: match.motivo }
    })
    .filter((item) => item.score >= 40)
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id))

  const top = ranked[0]
  if (!top || top.score < minimumNameScore) {
    return unresolved('unresolved', 'name_below_threshold', ranked.slice(0, 5).map((item) => (
      evidence(item.candidate, item.score, item.reason)
    )))
  }
  const second = ranked[1]
  if (second && second.score >= minimumNameScore && top.score - second.score < ambiguityMargin) {
    return unresolved('ambiguous', 'name_ambiguous', ranked.slice(0, 5).map((item) => (
      evidence(item.candidate, item.score, item.reason)
    )))
  }

  const status = top.reason === 'alias_manual'
    ? 'alias'
    : top.reason === 'nome_exato' || top.reason === 'mesmos_tokens'
      ? 'exact'
      : 'automatic'
  return {
    employeeId: top.candidate.id,
    status,
    confidence: top.score / 100,
    method: top.reason,
    candidates: [evidence(top.candidate, top.score, top.reason)],
  }
}

function resolved(
  candidate: EmployeeIdentityCandidate,
  status: EmployeeIdentityResolution['status'],
  confidence: number,
  method: string,
): EmployeeIdentityResolution {
  return {
    employeeId: candidate.id,
    status,
    confidence,
    method,
    candidates: [evidence(candidate, Math.round(confidence * 100), method)],
  }
}

function unresolved(
  status: 'ambiguous' | 'unresolved',
  method: string,
  candidates: EmployeeIdentityResolution['candidates'],
): EmployeeIdentityResolution {
  return { employeeId: null, status, confidence: null, method, candidates }
}

function evidence(
  candidate: EmployeeIdentityCandidate,
  score: number,
  reason: string,
): EmployeeIdentityResolution['candidates'][number] {
  return {
    employeeId: candidate.id,
    identificationCode: candidate.identificationCode,
    fullName: candidate.fullName,
    score,
    reason,
  }
}

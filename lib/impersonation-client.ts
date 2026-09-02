'use client'

import type { User } from '@/types'

export type ImpersonationMode = 'test' | 'operate'

export interface ImpersonationCompanyScope {
  companyId: string
  label: string
  allowedActions: string[]
}

export interface ImpersonationTarget {
  userId: string
  membershipId: string
  name: string
  email: string
  roleKey: string
  corporateProfile?: string
  companyId: string | null
  companyIds: string[]
  groupIds: string[]
  companyScopes: ImpersonationCompanyScope[]
}

export interface ImpersonationRepresentation {
  id: string
  mode: ImpersonationMode
  actor: {
    id: string
    name: string
    email: string
    roleKey: string
  }
  subject: {
    id: string
    name: string
    email: string
    roleKey: string
    membershipId: string
    corporateProfile?: string
  }
  reason: string
  reference: string | null
  allowedActions: string[]
  companyIds: string[]
  startedAt: string
  expiresAt: string
}

export interface ImpersonationActorSession {
  sessionId?: string
  membershipId: string
  roleKey: string
  platformAdmin: boolean
  user: User
}

export interface ImpersonationSessionState {
  actor: ImpersonationActorSession | null
  representation: ImpersonationRepresentation | null
  canStartRepresentation: boolean
  impersonationMfaRequired: boolean
}

export interface ImpersonationTargetResult {
  items: ImpersonationTarget[]
  total: number
}

export interface StartImpersonationInput {
  targetMembershipId: string
  companyId: string
  mode: ImpersonationMode
  reason: string
  reference?: string
}

export class ImpersonationClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function fetchImpersonationSessionState(
  signal?: AbortSignal,
): Promise<ImpersonationSessionState> {
  const payload = await impersonationRequest('/api/auth/session', { signal })
  return parseImpersonationSessionPayload(payload)
}

export async function listImpersonationTargets(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<ImpersonationTargetResult> {
  const search = new URLSearchParams({
    q: query.trim(),
    limit: String(Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)))),
  })
  const payload = await impersonationRequest(`/api/auth/impersonation/targets?${search}`, {
    signal: options.signal,
  })
  const rawItems = Array.isArray(payload.items) ? payload.items : []
  const items = rawItems.map(parseTarget).filter((item): item is ImpersonationTarget => Boolean(item))
  if (items.length !== rawItems.length) {
    throw new ImpersonationClientError(
      'O servidor retornou usuários inválidos para o acesso assistido.',
      'INVALID_IMPERSONATION_TARGETS',
      502,
    )
  }
  return {
    items,
    total: nonNegativeInteger(payload.total),
  }
}

export async function startImpersonation(
  input: StartImpersonationInput,
): Promise<ImpersonationRepresentation> {
  const payload = await impersonationRequest('/api/auth/impersonation/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetMembershipId: input.targetMembershipId,
      companyId: input.companyId.trim(),
      mode: input.mode,
      reason: input.reason.trim(),
      ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    }),
  })
  const representation = parseRepresentation(payload.representation)
  if (!representation) {
    throw new ImpersonationClientError(
      'O servidor iniciou o acesso, mas não retornou o contexto de representação.',
      'INVALID_IMPERSONATION_RESPONSE',
      502,
    )
  }
  return representation
}

export async function stopImpersonation(reason?: string): Promise<void> {
  await impersonationRequest('/api/auth/impersonation/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
  })
}

export async function stepUpImpersonationMfa(code: string): Promise<void> {
  await impersonationRequest('/api/auth/mfa/step-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  })
}

export function parseImpersonationSessionPayload(payload: unknown): ImpersonationSessionState {
  const record = object(payload)
  return {
    actor: parseActorSession(record.actor),
    representation: parseRepresentation(record.representation),
    canStartRepresentation: record.canStartRepresentation === true,
    impersonationMfaRequired: record.impersonationMfaRequired === true,
  }
}

function parseRepresentation(value: unknown): ImpersonationRepresentation | null {
  if (value === null || value === undefined) return null
  const record = object(value)
  const actor = object(record.actor)
  const subject = object(record.subject)
  const mode = record.mode === 'test' || record.mode === 'operate' ? record.mode : null
  const id = string(record.id)
  const startedAt = isoDate(record.startedAt)
  const expiresAt = isoDate(record.expiresAt)
  const actorId = string(actor.id)
  const subjectId = string(subject.id)
  const subjectMembershipId = string(subject.membershipId)
  if (!mode || !id || !startedAt || !expiresAt || !actorId || !subjectId || !subjectMembershipId) return null
  return {
    id,
    mode,
    actor: {
      id: actorId,
      name: string(actor.name),
      email: string(actor.email),
      roleKey: string(actor.roleKey),
    },
    subject: {
      id: subjectId,
      name: string(subject.name),
      email: string(subject.email),
      roleKey: string(subject.roleKey),
      membershipId: subjectMembershipId,
      ...(string(subject.corporateProfile) ? { corporateProfile: string(subject.corporateProfile) } : {}),
    },
    reason: string(record.reason),
    reference: string(record.reference) || null,
    allowedActions: strings(record.allowedActions),
    companyIds: strings(record.companyIds),
    startedAt,
    expiresAt,
  }
}

function parseActorSession(value: unknown): ImpersonationActorSession | null {
  if (!value) return null
  const record = object(value)
  const user = object(record.user)
  if (!string(record.membershipId) || !string(record.roleKey) || !string(user.id)) return null
  return {
    ...(string(record.sessionId) ? { sessionId: string(record.sessionId) } : {}),
    membershipId: string(record.membershipId),
    roleKey: string(record.roleKey),
    ...(string(record.corporateProfile) ? { corporateProfile: string(record.corporateProfile) } : {}),
    platformAdmin: record.platformAdmin === true,
    user: user as unknown as User,
  }
}

function parseTarget(value: unknown): ImpersonationTarget | null {
  const record = object(value)
  const userId = string(record.userId)
  const membershipId = string(record.membershipId)
  const name = string(record.name)
  const companyIds = uniqueStrings(record.companyIds)
  const companyScopes = parseCompanyScopes(record.companyScopes)
  const companyId = string(record.companyId)
  if (
    !userId
    || !membershipId
    || !name
    || !companyScopes
    || !sameIds(companyIds, companyScopes.map((scope) => scope.companyId))
    || (companyId && !companyIds.includes(companyId))
  ) return null
  return {
    userId,
    membershipId,
    name,
    email: string(record.email),
    roleKey: string(record.roleKey),
    ...(string(record.corporateProfile) ? { corporateProfile: string(record.corporateProfile) } : {}),
    companyId: companyId || null,
    companyIds,
    groupIds: strings(record.groupIds),
    companyScopes,
  }
}

function parseCompanyScopes(value: unknown): ImpersonationCompanyScope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const scopes: ImpersonationCompanyScope[] = []
  const companyIds = new Set<string>()
  for (const raw of value) {
    const record = object(raw)
    const companyId = string(record.companyId)
    const label = string(record.label)
    const allowedActions = strictStrings(record.allowedActions)
    if (!companyId || !label || !allowedActions || companyIds.has(companyId)) return null
    companyIds.add(companyId)
    scopes.push({ companyId, label, allowedActions })
  }
  return scopes
}

async function impersonationRequest(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const payload = object(await response.json().catch(() => null))
  if (!response.ok || payload.ok !== true) {
    throw new ImpersonationClientError(
      string(payload.error) || 'Não foi possível concluir o acesso assistido.',
      string(payload.code) || 'IMPERSONATION_REQUEST_FAILED',
      response.status,
    )
  }
  return payload
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function strictStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.some((item) => typeof item !== 'string' || !item.trim())) return null
  return uniqueStrings(value)
}

function uniqueStrings(value: unknown): string[] {
  return [...new Set(strings(value).map((item) => item.trim()))]
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const expected = new Set(left)
  return right.every((value) => expected.has(value))
}

function isoDate(value: unknown): string {
  const candidate = string(value)
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : ''
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0
}

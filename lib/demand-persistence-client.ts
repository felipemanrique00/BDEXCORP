'use client'

import {
  getAllAtendimentos,
  persistirAtendimentos,
  persistirAtendimentosRecebidosDoServidor,
} from '@/lib/atendimentos-storage'
import {
  createDemandOnServer,
  DemandClientError,
  getDemandFromServer,
  type DemandCreationClientResult,
  type DemandDetailsUpdateClientResult,
  updateDemandDetailsOnServer,
  updateDemandStatusOnServer,
} from '@/lib/demands-client'
import { shouldBlockAgencyAssistedLegacyFallback } from '@/lib/demands/agency-assistance'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'
import type { Atendimento, StatusAtendimento } from '@/types'

export interface PersistedDemandCreation {
  demand: Atendimento
  relational: boolean
  governance: DemandCreationClientResult | null
  localProjectionUpdated: boolean
}

export interface PersistedDemandUpdate {
  demand: Atendimento
  relational: boolean
  governance: DemandDetailsUpdateClientResult | null
  localProjectionUpdated: boolean
}

export interface PersistedDemandStatus {
  demand: Atendimento
  relational: boolean
  localProjectionUpdated: boolean
}

export async function persistNewDemandWithCompatibility(
  demand: Atendimento,
  submit = true,
): Promise<PersistedDemandCreation> {
  await commitPendingRemoteStorage()
  try {
    const governance = await createDemandOnServer(demand, submit)
    const localProjectionUpdated = replaceDemandProjection(governance.demand)
    return {
      demand: governance.demand,
      relational: true,
      governance,
      localProjectionUpdated,
    }
  } catch (error) {
    if (!(error instanceof DemandClientError)) {
      throw error
    }
    if (shouldBlockAgencyAssistedLegacyFallback(error.code, demand.agency_assisted === true)) {
      throw error
    }
    if (error.code !== 'DEMAND_RELATIONAL_WRITE_DISABLED') {
      throw error
    }
  }

  const current = getAllAtendimentos()
  const next = current.some((item) => item.id === demand.id)
    ? current.map((item) => item.id === demand.id ? demand : item)
    : [...current, demand]
  if (!persistirAtendimentos(next)) {
    throw new Error('Nao foi possivel preparar a demanda no modo legado.')
  }
  await commitPendingRemoteStorage()
  return {
    demand,
    relational: false,
    governance: null,
    localProjectionUpdated: true,
  }
}

export async function persistDemandPatchWithCompatibility(
  currentDemand: Atendimento,
  patch: Partial<Atendimento>,
  reason: string,
): Promise<PersistedDemandUpdate> {
  const updated: Atendimento = {
    ...currentDemand,
    ...patch,
    updated_at: new Date().toISOString(),
  }
  await commitPendingRemoteStorage()
  try {
    const currentRelational = await getDemandFromServer(currentDemand.id)
    const governance = await updateDemandDetailsOnServer(currentDemand.id, {
      demand: updated,
      expectedVersion: currentRelational.version,
      reason,
      idempotencyKey: `demand:update:${currentDemand.id}:${currentRelational.version}`,
    })
    return {
      demand: governance.item.demand,
      relational: true,
      governance,
      localProjectionUpdated: replaceDemandProjection(governance.item.demand),
    }
  } catch (error) {
    if (
      !(error instanceof DemandClientError)
      || !['DEMAND_NOT_FOUND', 'DEMAND_RELATIONAL_WRITE_DISABLED'].includes(error.code || '')
    ) {
      throw error
    }
  }

  const current = getAllAtendimentos()
  if (!current.some((item) => item.id === currentDemand.id)) {
    throw new Error('A demanda nao foi encontrada para atualizacao no modo legado.')
  }
  const next = current.map((item) => item.id === currentDemand.id ? updated : item)
  if (!persistirAtendimentos(next)) {
    throw new Error('Nao foi possivel preparar a atualizacao no modo legado.')
  }
  await commitPendingRemoteStorage()
  return {
    demand: updated,
    relational: false,
    governance: null,
    localProjectionUpdated: true,
  }
}

export async function persistDemandStatusWithCompatibility(
  currentDemand: Atendimento,
  status: StatusAtendimento,
  reason: string,
): Promise<PersistedDemandStatus> {
  await commitPendingRemoteStorage()
  try {
    const currentRelational = await getDemandFromServer(currentDemand.id)
    const result = await updateDemandStatusOnServer(currentDemand.id, {
      status,
      expectedVersion: currentRelational.version,
      reason,
      idempotencyKey: `demand:status:${currentDemand.id}:${currentRelational.version}:${status}`,
    })
    return {
      demand: result.item.demand,
      relational: true,
      localProjectionUpdated: replaceDemandProjection(result.item.demand),
    }
  } catch (error) {
    if (
      !(error instanceof DemandClientError)
      || !['DEMAND_NOT_FOUND', 'DEMAND_RELATIONAL_WRITE_DISABLED'].includes(error.code || '')
    ) {
      throw error
    }
  }

  const updated: Atendimento = {
    ...currentDemand,
    status,
    updated_at: new Date().toISOString(),
    finalizado_em: status === 'finalizado'
      ? new Date().toISOString()
      : currentDemand.finalizado_em,
  }
  const current = getAllAtendimentos()
  if (!current.some((item) => item.id === currentDemand.id)) {
    throw new Error('A demanda nao foi encontrada para atualizacao no modo legado.')
  }
  if (!persistirAtendimentos(
    current.map((item) => item.id === currentDemand.id ? updated : item),
  )) {
    throw new Error('Nao foi possivel preparar o status no modo legado.')
  }
  await commitPendingRemoteStorage()
  return {
    demand: updated,
    relational: false,
    localProjectionUpdated: true,
  }
}

function replaceDemandProjection(demand: Atendimento): boolean {
  const current = getAllAtendimentos()
  const next = current.some((item) => item.id === demand.id)
    ? current.map((item) => item.id === demand.id ? demand : item)
    : [...current, demand]
  return persistirAtendimentosRecebidosDoServidor(next)
}

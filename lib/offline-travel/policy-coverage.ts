import { sha256, type PolicyResultItem } from '@/lib/policy'

type ApprovalCoveragePolicy = Pick<
  PolicyResultItem,
  'policyVersionId' | 'policyCode' | 'action' | 'configuration'
>

/**
 * Vincula uma aprovacao ao conjunto exato e ordenado de passageiros e as
 * versoes das exigencias que a originaram. Uma republicacao de politica ou
 * troca de workflow invalida a cobertura anterior mesmo mantendo o codigo.
 */
export function offlinePolicyCoverageFingerprint(
  passengerIds: readonly string[],
  policies: readonly ApprovalCoveragePolicy[],
): string {
  const approvalPolicies = Array.from(new Map(policies.map((policy) => {
    const workflow = typeof policy.configuration.workflow === 'string'
      ? policy.configuration.workflow.trim()
      : null
    const value = {
      policyVersionId: policy.policyVersionId,
      policyCode: policy.policyCode,
      action: policy.action,
      workflow: workflow || null,
    }
    return [`${value.policyVersionId}:${value.policyCode}:${value.action}:${value.workflow || ''}`, value]
  })).values()).sort((left, right) => (
    `${left.policyVersionId}:${left.policyCode}:${left.action}:${left.workflow || ''}`
      .localeCompare(`${right.policyVersionId}:${right.policyCode}:${right.action}:${right.workflow || ''}`)
  ))
  return sha256({ passengerIds: [...passengerIds], approvalPolicies })
}

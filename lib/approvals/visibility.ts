export type ApprovalVisibilityMode = 'company_scope' | 'own_demands'

export function approvalVisibilityMode(input: {
  roleKey: string | null | undefined
  corporateProfile: string | null | undefined
}): ApprovalVisibilityMode {
  return input.roleKey === 'requester' || input.corporateProfile === 'requester'
    ? 'own_demands'
    : 'company_scope'
}

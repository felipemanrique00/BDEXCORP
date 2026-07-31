export function resolveUserAvatarUpdate(
  currentAvatar: string | null | undefined,
  requestedAvatar: string | null | undefined,
): string | null {
  return requestedAvatar === undefined ? currentAvatar || null : requestedAvatar
}

export function isSelfDeactivation(
  actorUserId: string,
  targetUserId: string,
  requestedActive: boolean | undefined,
): boolean {
  return actorUserId === targetUserId && requestedActive === false
}

export function isUnsafeSelfAdministrationChange(input: {
  actorUserId: string
  targetUserId: string
  actorRoleKey: string
  nextRoleKey: string
  platformAdmin: boolean
  hasExplicitScope: boolean
}): boolean {
  if (input.platformAdmin || input.actorUserId !== input.targetUserId) return false
  if (input.nextRoleKey !== input.actorRoleKey) return true
  return input.nextRoleKey !== 'tenant_admin' && input.hasExplicitScope
}

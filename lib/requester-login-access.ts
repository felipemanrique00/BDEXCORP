export function defaultRequesterLoginSelection(
  canManageLogins: boolean,
  linkedUserId: string | null | undefined,
  isEditing: boolean,
): boolean {
  return canManageLogins && (Boolean(linkedUserId) || !isEditing)
}

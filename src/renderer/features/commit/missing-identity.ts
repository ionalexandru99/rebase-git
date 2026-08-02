import type { IdentityField, ResolvedIdentity } from '@shared/schemas/git'

const IDENTITY_FIELDS: IdentityField[] = ['name', 'email']

export function missingIdentityFields(identity: ResolvedIdentity | null): IdentityField[] {
  if (!identity) {
    return []
  }
  return IDENTITY_FIELDS.filter((field) => (identity.effective[field] ?? '').trim().length === 0)
}

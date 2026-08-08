import type {
  GitIdentity,
  IdentityField,
  IdentityScope,
  ResolvedIdentity
} from '@shared/schemas/git'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import { gitIdentitySection } from './GitIdentitySection'

export interface IdentitySettings {
  resolved: ResolvedIdentity
  saving: boolean
  save: (scope: IdentityScope, identity: GitIdentity) => void
  clear: (fields: IdentityField[]) => void
}

export interface SettingsSectionContentProps {
  repoLabel: string | null
  identity: IdentitySettings
}

export interface SettingsSectionEntry {
  id: string
  label: string
  icon: LucideIcon
  Content: ComponentType<SettingsSectionContentProps>
  NavBadge?: ComponentType
}

export const settingsSections: SettingsSectionEntry[] = [gitIdentitySection]

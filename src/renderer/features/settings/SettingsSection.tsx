import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface SettingsSectionProps {
  icon: LucideIcon
  title: string
  description?: string
  children: ReactNode
}

export function SettingsSection(props: SettingsSectionProps) {
  const Icon = props.icon

  return (
    <section aria-label={props.title} className="px-6 py-5">
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{props.title}</h3>
      </div>
      {props.description ? (
        <p className="mt-1 text-xs text-muted-foreground">{props.description}</p>
      ) : null}
      <div className="mt-4 grid gap-3">{props.children}</div>
    </section>
  )
}

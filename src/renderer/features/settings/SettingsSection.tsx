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
    <section aria-label={props.title} className="min-w-0">
      <div className="px-3">
        <h3 className="flex items-center gap-2 font-semibold text-[17px] text-foreground leading-[1.3] tracking-[-0.025em]">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {props.title}
        </h3>
        {props.description ? (
          <p className="mt-0.5 text-[13px] text-muted-foreground/80 leading-[1.4]">
            {props.description}
          </p>
        ) : null}
      </div>
      <div className="mt-2.5 grid gap-0.5">{props.children}</div>
    </section>
  )
}

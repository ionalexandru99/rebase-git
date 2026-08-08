import type { KeyboardEvent } from 'react'
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import type { SettingsSectionEntry } from './sections'

interface SettingsNavProps {
  sections: SettingsSectionEntry[]
  activeSectionId: string
  onSelect: (sectionId: string) => void
}

export function SettingsNav(props: SettingsNavProps) {
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  const selectAndFocus = (section: SettingsSectionEntry) => {
    props.onSelect(section.id)
    itemRefs.current.get(section.id)?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const lastIndex = props.sections.length - 1
    let target: SettingsSectionEntry | undefined
    if (event.key === 'ArrowDown') {
      target = props.sections[index === lastIndex ? 0 : index + 1]
    } else if (event.key === 'ArrowUp') {
      target = props.sections[index === 0 ? lastIndex : index - 1]
    } else if (event.key === 'Home') {
      target = props.sections[0]
    } else if (event.key === 'End') {
      target = props.sections[lastIndex]
    }
    if (target) {
      event.preventDefault()
      selectAndFocus(target)
    }
  }

  return (
    <nav aria-label="Settings sections">
      <ul className="grid gap-1">
        {props.sections.map((section, index) => {
          const active = section.id === props.activeSectionId
          const Icon = section.icon
          const NavBadge = section.NavBadge
          return (
            <li key={section.id}>
              <button
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(section.id, element)
                  } else {
                    itemRefs.current.delete(section.id)
                  }
                }}
                type="button"
                aria-current={active ? 'true' : undefined}
                tabIndex={active ? 0 : -1}
                onClick={() => props.onSelect(section.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-medium text-sm transition-colors',
                  active
                    ? 'bg-card-2 text-foreground'
                    : 'text-muted-foreground hover:bg-card-2 hover:text-foreground'
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                {NavBadge ? <NavBadge /> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

import { SearchIcon } from 'lucide-react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { SettingsSearchEntry } from './search-index'

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'password', 'tel', 'number'])

function slashTypesIntoTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) {
    return true
  }
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type)
  }
  if (target instanceof HTMLElement) {
    return target.isContentEditable
  }
  return false
}

function dialogIsOpen(): boolean {
  return document.querySelector('dialog[open], [role="dialog"]') !== null
}

interface SettingsSearchProps {
  query: string
  results: SettingsSearchEntry[]
  onQueryChange: (query: string) => void
  onReveal: (entry: SettingsSearchEntry) => void
}

export function SettingsSearch(props: SettingsSearchProps) {
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const searching = props.query.trim().length > 0
  const activeEntry = props.results[activeIndex] ?? null

  useEffect(() => {
    const focusOnSlash = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return
      }
      if (slashTypesIntoTarget(event.target) || dialogIsOpen()) {
        return
      }
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', focusOnSlash)
    return () => window.removeEventListener('keydown', focusOnSlash)
  }, [])

  const changeQuery = (query: string): void => {
    setActiveIndex(0)
    props.onQueryChange(query)
  }

  const reveal = (entry: SettingsSearchEntry): void => {
    setActiveIndex(0)
    props.onReveal(entry)
  }

  const moveActiveIndex = (delta: number): void => {
    if (props.results.length === 0) {
      return
    }
    setActiveIndex((current) => (current + delta + props.results.length) % props.results.length)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActiveIndex(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActiveIndex(-1)
    } else if (event.key === 'Enter') {
      if (activeEntry !== null) {
        event.preventDefault()
        reveal(activeEntry)
      }
    } else if (event.key === 'Escape' && searching) {
      event.preventDefault()
      changeQuery('')
    }
  }

  const optionId = (entry: SettingsSearchEntry): string => `${listboxId}-${entry.rowId}`

  return (
    <div className="grid gap-2">
      <div className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 transition-colors focus-within:bg-card-2 hover:bg-card-2">
        <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/80" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search settings"
          aria-expanded={searching}
          aria-controls={listboxId}
          aria-activedescendant={
            searching && activeEntry !== null ? optionId(activeEntry) : undefined
          }
          aria-autocomplete="list"
          placeholder="Search"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={props.query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent font-medium text-sm outline-none placeholder:text-muted-foreground"
        />
        {searching ? null : (
          <kbd className="rounded-sm bg-card-2 px-1.5 font-sans text-[10px] text-muted-foreground ring-1 ring-border">
            /
          </kbd>
        )}
      </div>
      {searching ? (
        props.results.length === 0 ? (
          <p role="status" className="px-1 text-xs text-muted-foreground">
            No settings match your search.
          </p>
        ) : (
          <div id={listboxId} role="listbox" aria-label="Search results" className="grid gap-1">
            {props.results.map((entry, index) => (
              <button
                key={entry.rowId}
                type="button"
                id={optionId(entry)}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => reveal(entry)}
                className={cn(
                  'grid min-w-0 gap-0.5 rounded-[var(--r-sm)] px-2.5 py-1.5 text-left',
                  index === activeIndex
                    ? 'bg-card-2 text-foreground'
                    : 'text-muted-foreground hover:bg-card-2 hover:text-foreground'
                )}
              >
                <span className="truncate text-sm">{entry.title}</span>
                <span className="truncate text-xs text-muted-foreground">{entry.sectionLabel}</span>
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}

import type { CommitDetail } from '@shared/schemas/git'
import { useMemo } from 'react'
import { parseRefs } from '@/features/history/graph/refs'
import { avatarColor } from '@/features/repos/repo-avatar'
import { initials } from '@/lib/format'
import type { GitLogEntry } from '@/types'
import { RefBadge } from './RefBadge'

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : TIMESTAMP_FORMATTER.format(parsed)
}

interface CommitMetaProps {
  detail: CommitDetail
  entry?: GitLogEntry
  remotes: Record<string, string>
  remoteNames: Set<string>
  laneHex: string
}

export function CommitMeta(props: CommitMetaProps) {
  const detail = props.detail
  const entry = props.entry
  const refs = useMemo(
    () => (entry ? parseRefs(entry.refs, props.remoteNames) : []),
    [entry, props.remoteNames]
  )
  const parents = entry?.parents ?? []

  return (
    <div
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col gap-2 overflow-hidden border-b px-4 py-3"
      data-testid="commit-meta"
    >
      <h1 className="m-0 text-[15px] font-semibold leading-snug">{detail.subject}</h1>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <span className="flex min-w-0 shrink-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ background: avatarColor(detail.author.email || detail.author.name) }}
          >
            {initials(detail.author.name)}
          </span>
          <span className="font-medium text-foreground">{detail.author.name}</span>
          <span className="min-w-0 truncate" title={detail.author.email}>
            {detail.author.email}
          </span>
        </span>
        <time className="shrink-0 tabular-nums">{formatTimestamp(detail.authorDate)}</time>
        <span className="shrink-0 font-mono tabular-nums" data-testid="commit-detail-sha">
          {detail.sha.slice(0, 7)}
        </span>
        {parents.length > 0 ? (
          <span className="shrink-0 font-mono tabular-nums" data-testid="commit-detail-parents">
            {parents.length === 1 ? 'parent' : 'parents'}{' '}
            {parents.map((parent) => parent.slice(0, 7)).join(' ')}
          </span>
        ) : null}
        {refs.length > 0 ? (
          <span className="flex shrink-0 items-center gap-1">
            {refs.map((parsedRef) => (
              <RefBadge
                key={`${parsedRef.kind}:${parsedRef.label}`}
                parsedRef={parsedRef}
                laneHex={props.laneHex}
                remotes={props.remotes}
              />
            ))}
          </span>
        ) : null}
      </div>

      {detail.body ? (
        <p
          className="scroll-host m-0 min-h-0 max-w-[80ch] flex-1 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90"
          data-testid="commit-body"
        >
          {detail.body}
        </p>
      ) : null}
    </div>
  )
}

import type { CommitDetail } from '@shared/schemas/git'
import type { ReactNode } from 'react'

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
}

export function CommitMeta(props: CommitMetaProps) {
  const detail = props.detail

  return (
    <div className="shrink-0 space-y-2 border-b px-3 py-2" data-testid="commit-meta">
      {detail.body ? (
        <p className="max-h-24 max-w-[80ch] overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90">
          {detail.body}
        </p>
      ) : null}

      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-[13px]">
        <MetaRow label="Author" timestamp={formatTimestamp(detail.authorDate)}>
          <span className="shrink-0 font-medium text-foreground">{detail.author.name}</span>
          <span className="min-w-0 truncate text-muted-foreground" title={detail.author.email}>
            {detail.author.email}
          </span>
        </MetaRow>
        <MetaRow label={detail.parents.length === 1 ? 'Parent' : 'Parents'}>
          {detail.parents.length === 0 ? (
            <span className="text-muted-foreground">none — root commit</span>
          ) : (
            detail.parents.map((parent) => (
              <span key={parent} className="font-mono text-xs text-foreground/80" title={parent}>
                {parent.slice(0, 7)}
              </span>
            ))
          )}
        </MetaRow>
      </dl>
    </div>
  )
}

function MetaRow(props: { label: string; timestamp?: string; children: ReactNode }) {
  return (
    <>
      <dt className="shrink-0 text-muted-foreground">{props.label}</dt>
      <dd className="m-0 flex min-w-0 items-baseline gap-2">
        {props.children}
        {props.timestamp ? (
          <time className="ml-auto shrink-0 pl-3 tabular-nums text-muted-foreground">
            {props.timestamp}
          </time>
        ) : null}
      </dd>
    </>
  )
}

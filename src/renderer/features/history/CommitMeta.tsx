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
    // The labelled rows come first and never shrink; the body is the only part that gives. So when a
    // long message meets a short panel, the reader keeps the identity rows and the files/diff split
    // below, and the body scrolls in whatever room is left. Past ~9 lines a body is scrolled either
    // way, so the absolute cap stops a tall panel from handing it space the diff would use better.
    <div
      className="flex max-h-[min(45%,12rem)] min-h-0 shrink-0 flex-col gap-1.5 overflow-hidden border-b px-3 py-2"
      data-testid="commit-meta"
    >
      <dl className="m-0 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-[13px]">
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

      {detail.body ? (
        <p
          className="scroll-host min-h-0 max-w-[80ch] flex-1 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90"
          data-testid="commit-body"
        >
          {detail.body}
        </p>
      ) : null}
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

import type { CommitDetail } from '@shared/schemas/git'

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
    <div
      className="flex max-h-[min(45%,12rem)] min-h-0 shrink-0 flex-col gap-1.5 overflow-hidden border-b px-3 py-2"
      data-testid="commit-meta"
    >
      <dl className="m-0 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 text-[13px]">
        <dt className="shrink-0 text-muted-foreground">Author</dt>
        <dd className="m-0 flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-medium text-foreground">{detail.author.name}</span>
          <span className="min-w-0 truncate text-muted-foreground" title={detail.author.email}>
            {detail.author.email}
          </span>
          <time className="ml-auto shrink-0 pl-3 tabular-nums text-muted-foreground">
            {formatTimestamp(detail.authorDate)}
          </time>
        </dd>
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

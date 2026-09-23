import type { CommitInspection } from "@rebase/contracts";
import { CopyPill } from "#web/features/clipboard/index";
import { CommitMessage } from "#web-ui/features/commit-inspection/components/commit-message";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function CommitMetadata({
  details,
}: {
  readonly details: CommitInspection;
}) {
  const [subject, ...message] = details.message.trimEnd().split("\n");
  const body = message.join("\n").replace(/^\n+/, "");
  const date = new Date(details.author.date);
  return (
    <header className="max-h-[50%] shrink-0 overflow-auto border-border border-b px-4 py-3 text-xs">
      <h2 className="break-words text-base font-medium">{subject}</h2>
      {body ? <CommitMessage key={body} body={body} /> : null}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground">
        <span className="min-w-0 break-words">{details.author.name}</span>
        <time className="tabular-nums" dateTime={details.author.date}>
          {Number.isNaN(date.getTime())
            ? details.author.date
            : dateFormat.format(date)}
        </time>
        <CopyPill
          value={details.oid}
          className="ml-auto rounded-sm font-mono text-[11px] hover:text-foreground focus-visible:outline-1 focus-visible:outline-primary"
        >
          {details.oid.slice(0, 8)}
        </CopyPill>
      </div>
    </header>
  );
}

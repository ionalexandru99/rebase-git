import type { CommitInspection } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "#web-ui/components/ui/button";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

export function CommitMetadata({
  details,
}: {
  readonly details: CommitInspection;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subject, ...message] = details.message.trimEnd().split("\n");
  const body = message.join("\n").replace(/^\n+/, "");
  const sameIdentity =
    details.author.name === details.committer.name &&
    details.author.email === details.committer.email &&
    details.author.date === details.committer.date;
  return (
    <header className="max-h-72 shrink-0 overflow-auto border-border border-b px-5 py-4 text-xs">
      <h2 className="break-words text-base font-medium">{subject}</h2>
      {body ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {body}
        </p>
      ) : null}
      <div className="mt-4 space-y-3">
        <CommitIdentity
          identity={details.author}
          label={sameIdentity ? "Author & committer" : "Author"}
        />
        {!sameIdentity ? (
          <CommitIdentity identity={details.committer} label="Committer" />
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="shrink-0">Commit</span>
        <code className="min-w-0 select-text break-all font-mono">
          {expanded ? details.oid : details.oid.slice(0, 8)}
        </code>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={
            expanded ? "Show short commit SHA" : "Show full commit SHA"
          }
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <IconChevronUp /> : <IconChevronDown />}
        </Button>
      </div>
    </header>
  );
}

function CommitIdentity({
  identity,
  label,
}: {
  readonly identity: CommitInspection["author"];
  readonly label: string;
}) {
  const date = new Date(identity.date);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words">
          {identity.name}{" "}
          <span className="text-[11px] text-muted-foreground">
            {identity.email}
          </span>
        </p>
        <time
          className="text-muted-foreground tabular-nums"
          dateTime={identity.date}
        >
          {Number.isNaN(date.getTime())
            ? identity.date
            : dateFormat.format(date)}
        </time>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

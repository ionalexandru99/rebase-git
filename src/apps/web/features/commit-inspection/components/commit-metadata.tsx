import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CommitInspection } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { CopyPill } from "#web/features/clipboard/components/copy-pill.tsx";

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

function CommitMessage({ body }: { readonly body: string }) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = paragraph.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(
        getComputedStyle(element).lineHeight,
      );
      setOverflows(element.scrollHeight > lineHeight * 2 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mt-1">
      <p
        id={id}
        ref={paragraph}
        className={`whitespace-pre-wrap break-words text-sm text-muted-foreground ${expanded ? "max-h-40 overflow-y-auto" : "line-clamp-2"}`}
      >
        {body}
      </p>
      {overflows ? (
        <Button
          variant="ghost"
          size="xs"
          className="mt-1 h-auto px-0 py-0.5 text-muted-foreground"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}

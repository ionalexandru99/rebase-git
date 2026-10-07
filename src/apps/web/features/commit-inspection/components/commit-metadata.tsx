import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CommitInspection } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { CopyPill } from "#web/features/clipboard/components/copy-pill.tsx";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const fence = /^\s*```/;
const ownLine = /^\s*(\||#+\s|```)/;
const blockStart = /^(\s{4}|\t|\s*([-*+>]\s|\d+[.)]\s)|[A-Za-z][\w-]*: )/;

export function CommitMetadata({
  details,
}: {
  readonly details: CommitInspection;
}) {
  const id = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const preview = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [subject, ...message] = details.message.trimEnd().split("\n");
  const body = reflowMessage(message.join("\n"));
  const lede = body.split(/\n\s*\n/, 1)[0] ?? "";
  const date = new Date(details.author.date);

  useLayoutEffect(() => {
    if (expanded) return;
    const elements = [title.current, preview.current].filter(
      (element) => element !== null,
    );
    const measure = () =>
      setClipped(
        elements.some(
          (element) => element.scrollHeight > element.clientHeight + 1,
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <header
      id={id}
      className="max-h-[50%] shrink-0 overflow-auto border-border border-b px-4 py-3 text-xs"
    >
      <h2
        ref={title}
        className={`break-words text-sm font-semibold ${expanded ? "" : "line-clamp-2"}`}
      >
        {subject}
      </h2>
      {body ? (
        <p
          ref={preview}
          className={`mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground ${expanded ? "max-h-40 overflow-y-auto" : "line-clamp-2"}`}
        >
          {expanded ? body : lede}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground">
        <span className="min-w-0 break-words">{details.author.name}</span>
        <time className="tabular-nums" dateTime={details.author.date}>
          {Number.isNaN(date.getTime())
            ? details.author.date
            : dateFormat.format(date)}
        </time>
        <CopyPill
          value={details.oid}
          className="rounded-sm font-mono hover:text-foreground focus-visible:outline-1 focus-visible:outline-primary"
        >
          {details.oid.slice(0, 8)}
        </CopyPill>
        {expanded || clipped || lede !== body ? (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto h-auto gap-0.5 px-0 py-0 text-muted-foreground aria-expanded:bg-transparent sm:h-auto"
            aria-controls={id}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Less" : "More"}
            {expanded ? (
              <IconChevronUp className="size-3.5" aria-hidden="true" />
            ) : (
              <IconChevronDown className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function reflowMessage(message: string) {
  const lines = message.trim().split("\n");
  let text = "";
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    const previous = lines[index - 1];
    if (previous === undefined) text = line;
    else if (
      fenced ||
      line.trim() === "" ||
      previous.trim() === "" ||
      ownLine.test(line) ||
      ownLine.test(previous) ||
      blockStart.test(line)
    )
      text += `\n${line}`;
    else text += ` ${line.trim()}`;
    if (fence.test(line)) fenced = !fenced;
  }
  return text;
}

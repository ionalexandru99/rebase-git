import { IconChevronDown, IconGitCommit } from "@tabler/icons-react";
import { type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import type { ComparisonCommit } from "#contracts/repository-comparison/compare-revisions.contract.ts";

export interface CommitRun {
  readonly first: number;
  readonly last: number;
}

export function ComparisonCommits({
  commits,
  complete,
  run,
  onRun,
}: {
  readonly commits: readonly ComparisonCommit[];
  readonly complete: boolean;
  readonly run: CommitRun | undefined;
  readonly onRun: (run: CommitRun | undefined) => void;
}) {
  const [open, setOpen] = useState(true);
  const anchor = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const picked = (index: number) =>
    run !== undefined && index >= run.first && index <= run.last;
  const pick = (index: number, extend: boolean) => {
    if (!extend) anchor.current = index;
    const next = {
      first: Math.min(anchor.current, index),
      last: Math.max(anchor.current, index),
    };
    const oldest = commits[next.last];
    if (oldest?.parentOid === null) return;
    onRun(
      !extend && run?.first === index && run.last === index ? undefined : next,
    );
  };
  const click = (event: MouseEvent, index: number) =>
    pick(index, event.shiftKey && run !== undefined);
  const keyDown = (event: KeyboardEvent, index: number) => {
    if (event.key === "Escape" && run !== undefined) {
      event.preventDefault();
      onRun(undefined);
      return;
    }
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const next = index + step;
    if (step === 0 || next < 0 || next >= commits.length) return;
    event.preventDefault();
    list.current?.querySelectorAll("button")[next]?.focus();
    if (event.shiftKey) pick(next, run !== undefined);
  };
  const count =
    run === undefined
      ? `${commits.length}${complete ? "" : "+"}`
      : `${run.last - run.first + 1} of ${commits.length}${complete ? "" : "+"}`;
  if (commits.length === 0) return null;
  return (
    <section aria-label="Commits" className="flex shrink-0 flex-col">
      <div className="mx-1 shrink-0">
        <button
          type="button"
          aria-label={`${open ? "Collapse" : "Expand"} commits`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="relative flex h-8 w-full cursor-default items-center gap-2 rounded-control px-1.5 text-left text-[.8rem] text-sidebar-foreground outline-none select-none hover:bg-sidebar-accent/50 focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <IconGitCommit aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">Commits ({count})</span>
          <span
            aria-hidden="true"
            className="h-px min-w-3 flex-1 bg-current opacity-40"
          />
          <IconChevronDown
            aria-hidden="true"
            className={`size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open ? (
        <ul ref={list} className="max-h-48 overflow-auto px-1">
          {commits.map((commit, index) => (
            <li key={commit.oid}>
              <button
                type="button"
                aria-pressed={picked(index)}
                onClick={(event) => click(event, index)}
                onKeyDown={(event) => keyDown(event, index)}
                className={`flex h-8 w-full cursor-default items-center gap-2 px-2.5 text-left text-[.85rem] text-sidebar-foreground outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset ${
                  run === undefined
                    ? "rounded-control hover:bg-sidebar-accent/75"
                    : picked(index)
                      ? "border-primary border-l-2 pl-2"
                      : "rounded-control opacity-40 hover:opacity-100"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {commit.subject}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

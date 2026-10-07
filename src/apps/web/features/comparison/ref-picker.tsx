import {
  IconCloud,
  IconGitBranch,
  IconGitCommit,
  IconSearch,
  IconTag,
} from "@tabler/icons-react";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import type { ComparisonSide } from "#contracts/repository-comparison/compare-revisions.contract.ts";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import { Input } from "#web/components/ui/input.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { RefPillLabel } from "#web/features/commit-graph/components/commit-ref-labels.tsx";
import { sideLabel, sideName } from "#web/features/comparison/comparison.ts";
import { useScopedRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

const refLimit = 50;
const commitLimit = 20;

interface Option {
  readonly key: string;
  readonly side: ComparisonSide;
  readonly text: string;
}

export function RefPicker({
  label,
  side,
  history,
  onPick,
}: {
  readonly label: string;
  readonly side: ComparisonSide;
  readonly history: Pick<RepositoryHistory, "ask"> | undefined;
  readonly onPick: (side: ComparisonSide) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${label} ${sideName(side)}`}
        className="inline-flex min-w-0 rounded-control outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <RefPillLabel label={sideLabel(side)} />
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={label} className="w-80 p-1">
        <RefOptions
          label={label}
          history={history}
          onPick={(next) => {
            setOpen(false);
            onPick(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function RefOptions({
  label,
  history,
  onPick,
}: {
  readonly label: string;
  readonly history: Pick<RepositoryHistory, "ask"> | undefined;
  readonly onPick: (side: ComparisonSide) => void;
}) {
  const id = useId();
  const { refs } = useScopedRepositoryRefs();
  const [query, setQuery] = useState("");
  const commits = useCommitSearch(history, query.trim());
  const options = [
    ...refOptions(refs, query.trim().toLowerCase()),
    ...commits.map(
      (commit): Option => ({
        key: `commit\0${commit.oid}`,
        side: { _tag: "Commit", oid: commit.oid },
        text: commit.subject,
      }),
    ),
  ];
  const [highlightedKey, setHighlightedKey] = useState<string>();
  const highlighted =
    options.find((option) => option.key === highlightedKey) ?? options[0];
  const elementId = (option: Option) => `${id}-${options.indexOf(option)}`;
  const move = (offset: number) => {
    const index = highlighted === undefined ? -1 : options.indexOf(highlighted);
    const next =
      options[Math.max(0, Math.min(options.length - 1, index + offset))];
    if (next === undefined) return;
    setHighlightedKey(next.key);
    document
      .getElementById(elementId(next))
      ?.scrollIntoView({ block: "nearest" });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter" && highlighted !== undefined)
      onPick(highlighted.side);
    else return;
    event.preventDefault();
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="relative p-1">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-activedescendant={
            highlighted === undefined ? undefined : elementId(highlighted)
          }
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-expanded="true"
          aria-label={label}
          autoComplete="off"
          autoFocus
          className="h-7 pl-7 text-[.85rem] sm:h-7 sm:text-[.85rem]"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Branch, tag or commit"
          role="combobox"
          spellCheck={false}
          value={query}
        />
      </div>
      <div
        aria-label={label}
        className="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
        id={`${id}-list`}
        role="listbox"
      >
        {options.map((option) => (
          <button
            key={option.key}
            aria-selected={option === highlighted}
            className={`flex h-8 shrink-0 cursor-default items-center gap-2 rounded-control px-2 text-left text-[.85rem] outline-none ${option === highlighted ? "bg-accent text-foreground" : "text-foreground/80"}`}
            id={elementId(option)}
            onClick={() => onPick(option.side)}
            onPointerMove={() => setHighlightedKey(option.key)}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <SideIcon side={option.side} />
            <span className="min-w-0 flex-1 truncate">{option.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SideIcon({ side }: { readonly side: ComparisonSide }) {
  const Icon =
    side._tag === "LocalBranch"
      ? IconGitBranch
      : side._tag === "RemoteBranch"
        ? IconCloud
        : side._tag === "Tag"
          ? IconTag
          : IconGitCommit;
  return (
    <Icon
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground"
    />
  );
}

function refOptions(refs: RepositoryRefs | undefined, query: string) {
  if (refs === undefined) return [];
  const sides: ComparisonSide[] = [
    ...refs.branches.map(
      ({ name }): ComparisonSide => ({ _tag: "LocalBranch", name }),
    ),
    ...refs.remoteBranches.map(
      ({ name, remote }): ComparisonSide => ({
        _tag: "RemoteBranch",
        name,
        remote,
      }),
    ),
    ...refs.tags.map(({ name }): ComparisonSide => ({ _tag: "Tag", name })),
  ];
  return sides
    .filter((side) => sideName(side).toLowerCase().includes(query))
    .slice(0, refLimit)
    .map(
      (side): Option => ({
        key: `${side._tag}\0${sideName(side)}`,
        side,
        text: sideName(side),
      }),
    );
}

function useCommitSearch(
  history: Pick<RepositoryHistory, "ask"> | undefined,
  text: string,
) {
  const [found, setFound] = useState<{
    readonly text: string;
    readonly commits: readonly RepositoryCommit[];
  }>();
  useEffect(() => {
    if (history === undefined || text.length < 2) return;
    const controller = new AbortController();
    searchCommits(history, text, controller.signal).then(
      (commits) => setFound({ text, commits }),
      () => undefined,
    );
    return () => controller.abort();
  }, [history, text]);
  return found?.text === text ? found.commits : [];
}

async function searchCommits(
  history: Pick<RepositoryHistory, "ask">,
  text: string,
  signal: AbortSignal,
) {
  let cursor: string | undefined;
  for (;;) {
    const page = await history.ask(
      {
        _tag: "Search",
        text,
        limit: commitLimit,
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    );
    if (page.commits.length > 0 || page.cursor === undefined)
      return page.commits;
    if (page.cursor === cursor) return [];
    cursor = page.cursor;
  }
}

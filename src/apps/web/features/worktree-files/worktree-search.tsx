import { IconFile, IconLetterCase, IconSearch } from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import { useState } from "react";
import type { RouteInput } from "#contracts/environment-connection/environment-route.contract.ts";
import type {
  WorktreeFilesApi,
  WorktreeTextMatch,
} from "#contracts/worktree-files/worktree-files.contract.ts";
import { FileIcon } from "#web/components/ui/file-icon.tsx";
import { IconSwitch } from "#web/components/ui/icon-switch.tsx";
import { Input } from "#web/components/ui/input.tsx";
import type { WorktreeScope } from "#web/features/worktree-files/worktree-tree.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";

export type SearchKind = "names" | "text";

const kindOptions = [
  { value: "names", label: "Search file names", Icon: IconFile },
  { value: "text", label: "Search text", Icon: IconLetterCase },
] as const;

export function useQueuedSearch<
  Route extends
    | typeof WorktreeFilesApi.searchNames
    | typeof WorktreeFilesApi.searchText,
>(route: Route, scope: WorktreeScope, text: string, enabled: boolean) {
  const wanted = enabled ? text.trim().slice(0, 256) : "";
  const [running, setRunning] = useState(wanted);
  const input: RouteInput<Route> | typeof skipToken =
    running === "" ? skipToken : { ...scope, query: running };
  const result = useEnvironmentQuery(route, input, {
    changes: "index",
    staleTime: 0,
    keepPrevious: true,
  });
  if (running !== wanted && (wanted === "" || !result.isFetching))
    setRunning(wanted);
  return {
    data: running === "" ? undefined : result.data,
    searching: running !== wanted || result.isFetching,
  };
}

export function SearchBar({
  value,
  kind,
  onValue,
  onKind,
}: {
  readonly value: string;
  readonly kind: SearchKind;
  readonly onValue: (value: string) => void;
  readonly onKind: (kind: SearchKind) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 p-2">
      <div className="relative min-w-0 flex-1">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label={kind === "text" ? "Search text" : "Search files"}
          placeholder={kind === "text" ? "Search text" : "Search files"}
          className="pl-9"
          spellCheck={false}
          value={value}
          onChange={(event) => onValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && value !== "") {
              event.preventDefault();
              onValue("");
            }
          }}
        />
      </div>
      <IconSwitch
        label="Search in"
        options={kindOptions}
        value={kind}
        onChange={onKind}
      />
    </div>
  );
}

export function TextMatches({
  matches,
  complete,
  query,
  selected,
  onOpen,
}: {
  readonly matches: readonly WorktreeTextMatch[];
  readonly complete: boolean;
  readonly query: string;
  readonly selected: { readonly path: string; readonly line?: number } | null;
  readonly onOpen: (path: string, line: number) => void;
}) {
  const groups = Map.groupBy(matches, (match) => match.path);
  return (
    <div className="min-h-0 flex-1 overflow-auto px-1 pb-1">
      <ul aria-label="Text matches">
        {[...groups].map(([path, lines]) => {
          const name = path.slice(path.lastIndexOf("/") + 1);
          return (
            <li key={path}>
              <div className="flex h-7 items-center gap-2 px-1.5 text-body text-sidebar-foreground">
                <FileIcon path={path} />
                <span className="shrink-0 truncate">{name}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                  {path.slice(0, -name.length - 1)}
                </span>
              </div>
              {lines.map((match) => (
                <button
                  type="button"
                  key={match.line}
                  aria-label={`${path} line ${match.line}`}
                  aria-pressed={
                    selected?.path === path && selected.line === match.line
                  }
                  onClick={() => onOpen(path, match.line)}
                  className="flex h-6 w-full cursor-default items-center gap-2 rounded-control pr-1.5 pl-7 text-left text-meta text-sidebar-foreground outline-none hover:bg-sidebar-accent/75 focus-visible:ring-1 focus-visible:ring-sidebar-ring aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
                >
                  <span className="w-8 shrink-0 text-right font-mono text-muted-foreground tabular-nums">
                    {match.line}
                  </span>
                  <span className="truncate font-mono">
                    <Highlighted text={match.text} query={query} />
                  </span>
                </button>
              ))}
            </li>
          );
        })}
      </ul>
      {matches.length === 0 ? (
        <p className="p-3 text-meta text-muted-foreground">No matches</p>
      ) : complete ? null : (
        <p className="px-2 py-2 text-meta text-muted-foreground">
          First {matches.length} matches
        </p>
      )}
    </div>
  );
}

function Highlighted({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}) {
  const caseless = query === query.toLowerCase();
  const index = (caseless ? text.toLowerCase() : text).indexOf(query);
  if (index < 0) return text;
  const start = index > 16 ? index - 12 : 0;
  return (
    <>
      {start > 0 ? "…" : ""}
      {text.slice(start, index)}
      <mark className="rounded-[3px] bg-amber-300/35 text-inherit dark:bg-amber-400/25">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

import { File, useVirtualizer, Virtualizer } from "@pierre/diffs/react";
import { IconFiles } from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  maximumFileBytes,
  type WorktreeFile,
  WorktreeFilesApi,
} from "#contracts/worktree-files/worktree-files.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable.tsx";
import {
  diffSurfaceCSS,
  diffThemes,
} from "#web/features/file-diff/components/diff-content.tsx";
import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool.tsx";
import { useTheme } from "#web/features/theme/theme.ts";
import { useWorkingChanges } from "#web/features/working-changes/hooks/use-working-changes.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import {
  SearchBar,
  type SearchKind,
  TextMatches,
  useQueuedSearch,
} from "#web/features/worktree-files/worktree-search.tsx";
import {
  type WorktreeScope,
  WorktreeTree,
} from "#web/features/worktree-files/worktree-tree.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";

const lineHeight = 20;
const filePadding = 8;

interface OpenFile {
  readonly path: string;
  readonly line?: number;
}

export function WorktreeFilesPanel() {
  const feature = usePanelFeature();
  if (feature?.scope === undefined) return null;
  const { repositoryId, worktreePath } = feature.scope;
  return (
    <DiffWorkerPool>
      <WorktreeFiles
        key={worktreePath}
        scope={{ repositoryId, worktreePath }}
        active={feature.active}
      />
    </DiffWorkerPool>
  );
}

function WorktreeFiles({
  scope,
  active,
}: {
  readonly scope: WorktreeScope;
  readonly active: boolean;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind>("names");
  const [open, setOpen] = useState<OpenFile | null>(null);
  const changes = useWorkingChanges({ ...scope, amend: false }, active).data;
  const names = useQueuedSearch(
    WorktreeFilesApi.searchNames,
    scope,
    query,
    active && kind === "names",
  );
  const text = useQueuedSearch(
    WorktreeFilesApi.searchText,
    scope,
    query,
    active && kind === "text",
  );
  const searchingText = kind === "text" && query.trim() !== "";
  const failedSearch = kind === "text" ? text : names;
  return (
    <section aria-label="Files" className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="files-view" defaultSize="70%" minSize="12rem">
          {open === null ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <IconFiles aria-hidden="true" className="size-8 opacity-50" />
            </div>
          ) : (
            <FileView
              key={open.path}
              scope={scope}
              file={open}
              active={active}
            />
          )}
        </ResizablePanel>
        <ResizableHandle aria-label="Resize file tree" />
        <ResizablePanel
          id="files-tree"
          defaultSize="21rem"
          groupResizeBehavior="preserve-pixel-size"
          minSize="12.5rem"
          maxSize="26rem"
        >
          <div className="flex h-full min-h-0 flex-col border-border border-l bg-sidebar pb-1">
            <SearchBar
              value={query}
              kind={kind}
              onValue={setQuery}
              onKind={setKind}
            />
            {failedSearch.error === null ? null : (
              <div role="alert" className="px-3 pb-2 text-body">
                {describeFailure(failedSearch.error)}{" "}
                <Button size="xs" variant="ghost" onClick={failedSearch.retry}>
                  Retry
                </Button>
              </div>
            )}
            <WorktreeTree
              scope={scope}
              changes={changes}
              matches={kind === "names" ? (names.data?.paths ?? []) : []}
              query={kind === "names" ? query.trim() : ""}
              selected={open?.path ?? null}
              hidden={searchingText}
              onOpen={(path) => setOpen({ path })}
            />
            {searchingText ? (
              text.error !== null ? null : text.data === undefined ? (
                <p
                  role="status"
                  className="p-3 text-meta text-muted-foreground"
                >
                  Searching…
                </p>
              ) : (
                <TextMatches
                  matches={text.data.matches}
                  complete={text.data.complete}
                  query={query.trim()}
                  selected={open}
                  onOpen={(path, line) => setOpen({ path, line })}
                />
              )
            ) : null}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}

function FileView({
  scope,
  file,
  active,
}: {
  readonly scope: WorktreeScope;
  readonly file: OpenFile;
  readonly active: boolean;
}) {
  const read = useEnvironmentQuery(
    WorktreeFilesApi.read,
    active ? { ...scope, path: file.path } : skipToken,
    { changes: "index", staleTime: 0, refetchOnWindowFocus: true },
  );
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  return (
    <section
      aria-label={file.path}
      aria-busy={read.isFetching}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="shrink-0 border-border border-b px-4 pt-3 pb-3">
        <h2 className="truncate font-semibold text-heading">{name}</h2>
        <p className="truncate text-body text-muted-foreground">
          {file.path.slice(0, -name.length)}
        </p>
      </header>
      {read.isError ? (
        <div role="alert" className="p-3 text-body">
          {describeFailure(read.error)}{" "}
          <Button size="xs" variant="ghost" onClick={() => void read.refetch()}>
            Retry
          </Button>
        </div>
      ) : read.data === undefined ? null : (
        <FileContents path={file.path} file={read.data} line={file.line} />
      )}
    </section>
  );
}

function FileContents({
  path,
  file,
  line,
}: {
  readonly path: string;
  readonly file: WorktreeFile;
  readonly line: number | undefined;
}) {
  switch (file._tag) {
    case "Missing":
      return <Notice>This file is no longer there.</Notice>;
    case "Binary":
      return <Notice>Binary file · {formatBytes(file.bytes)}</Notice>;
    case "Symlink":
      return (
        <Notice>
          Link to <span className="font-mono">{file.target}</span>
        </Notice>
      );
    case "Submodule":
      return (
        <Notice>
          Submodule
          {file.oid === null ? null : (
            <span className="font-mono"> at {file.oid.slice(0, 8)}</span>
          )}
        </Notice>
      );
    case "Text":
      return (
        <>
          {file.truncated ? (
            <p className="shrink-0 border-border border-b px-3 py-1.5 text-meta text-muted-foreground">
              First {formatBytes(maximumFileBytes)} of {formatBytes(file.bytes)}
            </p>
          ) : null}
          <Virtualizer
            className="min-h-0 flex-1 overflow-auto"
            config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
          >
            <SourceFile path={path} contents={file.contents} line={line} />
          </Virtualizer>
        </>
      );
  }
}

function SourceFile({
  path,
  contents,
  line,
}: {
  readonly path: string;
  readonly contents: string;
  readonly line: number | undefined;
}) {
  const theme = useTheme();
  const virtualizer = useVirtualizer();
  const pending = useRef(line);
  useEffect(() => {
    pending.current = line;
    const root = virtualizer?.getRoot();
    if (virtualizer === undefined || !(root instanceof HTMLElement)) return;
    const reveal = () => {
      const target = pending.current;
      if (target === undefined) return;
      const top = Math.max(
        0,
        filePadding + (target - 1) * lineHeight - root.clientHeight / 3,
      );
      if (root.scrollHeight < filePadding + target * lineHeight) return;
      virtualizer.scrollTo({ top });
      pending.current = undefined;
    };
    reveal();
    const resized = new ResizeObserver(reveal);
    for (const child of root.children) resized.observe(child);
    return () => resized.disconnect();
  }, [virtualizer, line]);
  return (
    <File
      style={
        {
          "--diffs-font-family": "var(--font-mono)",
          "--diffs-font-size": "var(--text-meta)",
          "--diffs-line-height": `${lineHeight}px`,
        } as CSSProperties
      }
      file={{ name: path, contents }}
      options={{
        theme: diffThemes,
        themeType: theme,
        disableFileHeader: true,
        overflow: "scroll",
        unsafeCSS: `${diffSurfaceCSS}${line === undefined ? "" : `\n[data-line="${line}"] { background: color-mix(in oklab, var(--color-amber-400) 18%, transparent); }`}`,
      }}
    />
  );
}

function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center p-6 text-body text-muted-foreground">
      {children}
    </p>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

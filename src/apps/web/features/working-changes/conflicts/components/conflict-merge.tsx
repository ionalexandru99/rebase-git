import { UnresolvedFile } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ConflictDocument,
  ConflictList,
  ConflictPath,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { WholeFileMenu } from "#web/features/working-changes/conflicts/components/whole-file-menu.tsx";
import { useConflictWrites } from "#web/features/working-changes/conflicts/hooks/use-conflict-writes.ts";
import {
  useConflictActions,
  useConflictDocument,
} from "#web/features/working-changes/conflicts/hooks/use-conflicts.ts";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view.ts";

const diffsStyle = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "12px",
  "--diffs-line-height": "20px",
} as CSSProperties;

const blockLead = 48;

export function ConflictMerge({
  view,
  input,
  document: loaded,
  writable,
}: {
  readonly view: Pick<WorkingChangesView, "select">;
  readonly input: ConflictPath;
  readonly document: ConflictDocument;
  readonly writable: boolean;
}) {
  const query = useConflictDocument(input);
  const document = query.data ?? loaded;
  const { refetch } = query;
  const [history, setHistory] = useState<readonly string[]>([]);
  const writes = useConflictWrites(input, document, () => {
    setHistory([]);
    void refetch();
  });
  const actions = useConflictActions(input, {
    revision: writes.revision,
    onResolved: (list: ConflictList) => {
      const next =
        list.files.find(({ openRegions }) => openRegions > 0) ?? list.files[0];
      if (next !== undefined)
        view.select({ section: "conflicts", path: next.path });
    },
  });
  const [total] = useState(document.file.openRegions);
  const pane = useRef<HTMLElement>(null);
  const disabled = !writable || actions.busy;
  const settle = async () => {
    await writes.settled();
    actions.reset();
  };
  const undo = () => {
    const previous = history.at(-1);
    if (previous === undefined || disabled) return;
    setHistory(history.slice(0, -1));
    writes.save(previous);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const key = keyAction(event);
    if (key === null) return;
    event.preventDefault();
    if (key === "undo") undo();
    else jumpToBlock(pane.current, key);
  };
  const problem = writes.problem ?? actions.problem;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="Conflict"
      onKeyDown={onKeyDown}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-border border-b p-2">
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground">
          {document.file.openRegions} of{" "}
          {Math.max(total, document.file.openRegions)} open
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous conflict"
          aria-keyshortcuts="Alt+ArrowUp"
          onClick={() => jumpToBlock(pane.current, -1)}
        >
          <IconArrowUp aria-hidden="true" className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next conflict"
          aria-keyshortcuts="Alt+ArrowDown"
          onClick={() => jumpToBlock(pane.current, 1)}
        >
          <IconArrowDown aria-hidden="true" className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          aria-keyshortcuts="Control+Z Meta+Z"
          disabled={disabled || history.length === 0}
          onClick={undo}
        >
          Undo
        </Button>
        <span className="flex-1" />
        <WholeFileMenu
          choices={document.file.choices}
          disabled={disabled}
          onChoose={async (choice) => {
            await settle();
            await actions.choose(input.path, choice);
          }}
        />
        {actions.confirming === input.path ? (
          <Confirmation
            title="Conflict markers remain"
            action="Mark resolved anyway"
            busy={actions.busy}
            disabled={disabled}
            onCancel={actions.cancel}
            onConfirm={() => void actions.resolve(input.path, true)}
            className="flex-nowrap"
          />
        ) : (
          <Button
            size="xs"
            disabled={disabled}
            onClick={async () => {
              await settle();
              await actions.resolve(input.path, false);
            }}
          >
            Mark resolved
          </Button>
        )}
      </div>
      {problem === null ? null : (
        <p
          role="alert"
          className="shrink-0 border-border border-b px-3 py-2 text-xs text-destructive"
        >
          {problem}
        </p>
      )}
      <UnresolvedBlocks
        paneRef={pane}
        path={input.path}
        content={document.content}
        revision={document.file.revision}
        onResolve={(resolved, previous) => {
          setHistory((past) => [...past, previous]);
          writes.save(resolved);
        }}
      />
    </section>
  );
}

function UnresolvedBlocks({
  paneRef,
  path,
  content,
  revision,
  onResolve,
}: {
  readonly paneRef: RefObject<HTMLElement | null>;
  readonly path: string;
  readonly content: string;
  readonly revision: string;
  readonly onResolve: (resolved: string, previous: string) => void;
}) {
  const pool = useWorkerPool();
  const shown = useRef<{ content: string; file: UnresolvedFile } | null>(null);
  const resolve = useRef(onResolve);
  resolve.current = onResolve;

  useEffect(() => {
    const container = paneRef.current;
    if (container === null || shown.current?.content === content) return;
    shown.current?.file.cleanUp();
    const file = new UnresolvedFile(
      {
        theme: "pierre-dark",
        overflow: "scroll",
        onMergeConflictResolve: (resolved) => {
          const current = shown.current;
          if (current === null) return;
          const previous = current.content;
          current.content = resolved.contents;
          file.rerender();
          resolve.current(resolved.contents, previous);
        },
      },
      pool,
    );
    shown.current = { content, file };
    file.render({
      file: { name: path, contents: content, cacheKey: revision },
      containerWrapper: container,
    });
  }, [content, path, pool, revision, paneRef]);

  useEffect(() => () => shown.current?.file.cleanUp(), []);

  return (
    <section
      ref={paneRef}
      aria-label="Working file"
      className="min-h-0 flex-1 overflow-auto"
      style={diffsStyle}
    />
  );
}

function jumpToBlock(pane: HTMLElement | null, direction: 1 | -1) {
  const blocks = pane
    ?.querySelector("diffs-container")
    ?.shadowRoot?.querySelectorAll('[data-merge-conflict="marker-start"]');
  if (pane == null || blocks === undefined) return;
  const top = pane.getBoundingClientRect().top + blockLead;
  const offsets = [...blocks].map(
    (block) => block.getBoundingClientRect().top - top,
  );
  const offset =
    direction === 1
      ? offsets.find((candidate) => candidate > 1)
      : offsets.findLast((candidate) => candidate < -1);
  if (offset !== undefined) pane.scrollBy({ top: offset });
}

function keyAction(event: KeyboardEvent<HTMLElement>) {
  if (event.altKey && event.key === "ArrowUp") return -1;
  if (event.altKey && event.key === "ArrowDown") return 1;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z")
    return "undo";
  return null;
}

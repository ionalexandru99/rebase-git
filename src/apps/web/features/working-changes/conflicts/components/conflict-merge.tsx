import { UnresolvedFile } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ConflictDocument,
  ConflictExcerpt,
  ConflictList,
  ConflictPath,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { diffSurfaceCSS } from "#web/features/file-diff/components/diff-content.tsx";
import { WholeFileMenu } from "#web/features/working-changes/conflicts/components/whole-file-menu.tsx";
import {
  type ConflictEdit,
  resolutionEdit,
  useConflictEdits,
} from "#web/features/working-changes/conflicts/hooks/use-conflict-edits.ts";
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
  const revision = document.file.revision;
  const [history, setHistory] = useState<readonly ConflictEdit[]>([]);
  const [failures, setFailures] = useState(0);
  const edits = useConflictEdits(input, () => {
    setHistory([]);
    void refetch();
  });
  const actions = useConflictActions(input, {
    revision: () => revision,
    onResolved: (list: ConflictList) => {
      const next =
        list.files.find(({ openRegions }) => openRegions > 0) ?? list.files[0];
      if (next !== undefined)
        view.select({ section: "conflicts", path: next.path });
    },
  });
  const [total] = useState(document.file.openRegions);
  const pane = useRef<HTMLElement>(null);
  const disabled = !writable || actions.busy || edits.running;
  const undo = async () => {
    const previous = history.at(-1);
    if (previous === undefined || disabled) return;
    if (await edits.apply(revision, previous))
      setHistory((past) => past.slice(0, -1));
  };
  const resolveBlock = (
    from: string,
    edit: ConflictEdit,
    reverse: ConflictEdit,
  ) => {
    if (!writable || actions.busy) return null;
    actions.cancel();
    return edits.apply(from, edit)?.then((applied) => {
      if (applied) setHistory((past) => [...past, reverse]);
      else setFailures((count) => count + 1);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const key = keyAction(event);
    if (key === null) return;
    event.preventDefault();
    if (key === "undo") void undo();
    else jumpToBlock(pane.current, key);
  };
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="Conflict"
      onKeyDown={onKeyDown}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-border border-b p-2">
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground">
          {document.file.openRegions}/
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
          onClick={() => void undo()}
        >
          Undo
        </Button>
        <span className="flex-1" />
        <WholeFileMenu
          choices={document.file.choices}
          disabled={disabled}
          onChoose={(choice) => actions.choose(input.path, choice)}
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
            onClick={() => void actions.resolve(input.path, false)}
          >
            Mark resolved
          </Button>
        )}
      </div>
      <section
        ref={pane}
        aria-label="Working file"
        className="min-h-0 flex-1 overflow-auto"
        style={diffsStyle}
      >
        {document.excerpts.map((excerpt) => (
          <ExcerptBlocks
            key={`${revision}:${failures}:${excerpt.line}`}
            path={input.path}
            revision={revision}
            excerpt={excerpt}
            onResolve={resolveBlock}
          />
        ))}
      </section>
    </section>
  );
}

function ExcerptBlocks({
  path,
  revision,
  excerpt,
  onResolve,
}: {
  readonly path: string;
  readonly revision: string;
  readonly excerpt: ConflictExcerpt;
  readonly onResolve: (
    revision: string,
    edit: ConflictEdit,
    reverse: ConflictEdit,
  ) => Promise<void> | null | undefined;
}) {
  const pool = useWorkerPool();
  const container = useRef<HTMLDivElement>(null);
  const resolve = useRef(onResolve);
  resolve.current = onResolve;

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const file = new UnresolvedFile(
      {
        theme: "pierre-dark",
        unsafeCSS: diffSurfaceCSS,
        overflow: "scroll",
        disableFileHeader: true,
        disableLineNumbers: true,
        maxContextLines: Number.POSITIVE_INFINITY,
        onMergeConflictAction: ({ resolution, conflict }) => {
          const { edit, undo } = resolutionEdit(excerpt, conflict, resolution);
          void resolve.current(revision, edit, undo);
        },
      },
      pool,
    );
    file.render({
      file: {
        name: path,
        contents: excerpt.text,
        cacheKey: `${revision}:${excerpt.line}`,
      },
      containerWrapper: element,
    });
    return () => file.cleanUp();
  }, [excerpt, path, pool, revision]);

  return (
    <>
      <p className="border-border border-b bg-muted/40 px-3 py-1 font-mono text-muted-foreground text-xs">
        Line {excerpt.line.toLocaleString()}
      </p>
      <div ref={container} />
    </>
  );
}

function jumpToBlock(pane: HTMLElement | null, direction: 1 | -1) {
  if (pane === null) return;
  const blocks = [...pane.querySelectorAll("diffs-container")].flatMap(
    (container) => [
      ...(container.shadowRoot?.querySelectorAll(
        '[data-merge-conflict="marker-start"]',
      ) ?? []),
    ],
  );
  const top = pane.getBoundingClientRect().top + blockLead;
  const offsets = blocks.map(
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

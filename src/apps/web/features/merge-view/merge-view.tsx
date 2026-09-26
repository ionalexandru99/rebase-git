import type { ConflictPath, ConflictSide } from "@rebase/contracts";
import { IconArrowDown, IconArrowLeft, IconArrowUp } from "@tabler/icons-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "#web/components/ui/button";
import { ResultEditor } from "#web/features/merge-view/components/result-editor";
import { SidePanes } from "#web/features/merge-view/components/side-panes";
import { openRegionCount } from "#web/features/merge-view/conflict-document";
import { useMergeDocument } from "#web/features/merge-view/hooks/use-merge-document";
import {
  type ResolveFile,
  useResolveFile,
} from "#web/features/merge-view/hooks/use-resolve-file";
import {
  type Selection,
  useSelection,
} from "#web/features/merge-view/hooks/use-selection";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import {
  describeChangesFailure,
  wholeFileOnly,
} from "#web/features/working-changes/changes-messages";
import { MarkersConfirmation } from "#web/features/working-changes/conflicts/components/markers-confirmation";
import { WholeFileMenu } from "#web/features/working-changes/conflicts/components/whole-file-menu";

export interface MergeViewProps {
  readonly path: string;
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
  readonly toolbarActions?: ReactNode;
}

type KeyAction = "close" | "previous" | "next" | "current" | "incoming";

export function MergeView({
  path,
  onOpen,
  onClose,
  toolbarActions,
}: MergeViewProps) {
  const scope = useRepositoryScope();
  if (scope === undefined) return null;
  return (
    <MergeViewContent
      key={JSON.stringify([scope.repositoryId, scope.worktreePath, path])}
      input={{
        repositoryId: scope.repositoryId,
        worktreePath: scope.worktreePath,
        path,
      }}
      onOpen={onOpen}
      onClose={onClose}
      toolbarActions={toolbarActions}
    />
  );
}

function MergeViewContent({
  input,
  onOpen,
  onClose,
  toolbarActions,
}: {
  readonly input: ConflictPath;
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
  readonly toolbarActions?: ReactNode;
}) {
  const merge = useMergeDocument(input);
  const resolve = useResolveFile({ input, document: merge, onOpen, onClose });
  const [showBase, setShowBase] = useState(false);
  const leftSide: ConflictSide = showBase ? "base" : "current";
  const selection = useSelection(merge.model, merge.choose, leftSide);
  const { model } = merge;
  const document = merge.document.data;
  const failure = merge.document.error;
  const wholeFile = wholeFileOnly(failure);
  const listed = merge.list.data?.files.find(({ path }) => path === input.path);
  const panes = !wholeFile && model !== null && document !== undefined;
  const notice =
    merge.notice ??
    (failure !== null && !wholeFile ? describeChangesFailure(failure) : null);

  return (
    <section
      aria-label="Merge view"
      className="flex h-full min-h-0 flex-col bg-repository"
      onKeyDown={(event) => handleKeys(event, selection, resolve, onClose)}
    >
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-1">
        <Button variant="ghost" size="xs" onClick={onClose}>
          <IconArrowLeft aria-hidden="true" className="size-3.5" />
          History
        </Button>
        <h1 className="min-w-0 truncate text-[.85rem] font-semibold">
          {input.path}
        </h1>
        {panes && (
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
            {openRegionCount(model)} of {model.regionCount} open
          </span>
        )}
        <span className="flex-1" />
        {panes && (
          <>
            <Button
              variant="outline"
              size="xs"
              aria-pressed={showBase}
              className="aria-pressed:bg-muted aria-pressed:text-foreground"
              onClick={() => setShowBase((shown) => !shown)}
            >
              Base
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous region"
              aria-keyshortcuts="Alt+ArrowUp"
              disabled={!selection.hasPrevious}
              onClick={selection.previous}
            >
              <IconArrowUp aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next region"
              aria-keyshortcuts="Alt+ArrowDown"
              disabled={!selection.hasNext}
              onClick={selection.next}
            >
              <IconArrowDown aria-hidden="true" className="size-3.5" />
            </Button>
          </>
        )}
        <WholeFileMenu
          choices={document?.file.choices ?? listed?.choices ?? []}
          mergeTool={(merge.list.data?.mergeTool ?? null) !== null}
          disabled={resolve.busy}
          onChoose={(choice) => void resolve.chooseWholeFile(choice)}
          onMergeTool={() => void resolve.openMergeTool()}
        />
        {panes &&
          (resolve.confirming ? (
            <MarkersConfirmation
              path={input.path}
              disabled={resolve.busy}
              cancel={resolve.cancelConfirmation}
              confirm={() => void resolve.markResolved(true)}
            />
          ) : (
            <Button
              size="xs"
              disabled={resolve.busy}
              onClick={() => void resolve.markResolved(false)}
            >
              Mark resolved
            </Button>
          ))}
        {toolbarActions}
      </div>
      {notice !== null && (
        <p
          role="status"
          className="shrink-0 border-border border-b px-3 py-1.5 text-xs text-muted-foreground"
        >
          {notice}
        </p>
      )}
      {panes && (
        <div className="flex min-h-0 flex-1 flex-col">
          <SidePanes
            model={model}
            sides={document.sides}
            leftSide={leftSide}
            activeRegion={selection.activeRegion}
            lines={selection.lines}
            scrollRef={selection.sidesRef}
          />
          <ResultEditor
            model={model}
            activeRegion={selection.activeRegion}
            onEdit={merge.edit}
            onUndo={merge.undo}
            onRegionClick={selection.focusFromResult}
            scrollRef={selection.resultRef}
          />
        </div>
      )}
    </section>
  );
}

function handleKeys(
  event: KeyboardEvent<HTMLElement>,
  selection: Selection,
  resolve: ResolveFile,
  onClose: () => void,
) {
  if (!event.currentTarget.contains(event.target as Node)) return;
  const action = keyAction(event);
  if (action === null) return;
  event.preventDefault();
  switch (action) {
    case "close":
      return resolve.confirming ? resolve.cancelConfirmation() : onClose();
    case "previous":
      return selection.previous();
    case "next":
      return selection.next();
    case "current":
    case "incoming":
      return selection.takeActive(action);
  }
}

function keyAction(event: KeyboardEvent<HTMLElement>): KeyAction | null {
  if (event.key === "Escape") return "close";
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "ArrowDown") return "next";
  if (event.code === "Digit1") return "current";
  if (event.code === "Digit2") return "incoming";
  return null;
}

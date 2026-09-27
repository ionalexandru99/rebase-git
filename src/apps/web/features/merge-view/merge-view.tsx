import type {
  ConflictList,
  ConflictPath,
  ConflictSide,
} from "@rebase/contracts";
import { IconArrowDown, IconArrowLeft, IconArrowUp } from "@tabler/icons-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "#web/components/ui/button";
import { Confirmation } from "#web/components/ui/confirmation";
import { ResultEditor } from "#web/features/merge-view/components/result-editor";
import { SidePanes } from "#web/features/merge-view/components/side-panes";
import {
  openCount,
  regionSegments,
} from "#web/features/merge-view/conflict-document";
import { useMergeDocument } from "#web/features/merge-view/hooks/use-merge-document";
import { useSelection } from "#web/features/merge-view/hooks/use-selection";
import { WholeFileMenu } from "#web/features/working-changes/conflicts/components/whole-file-menu";
import {
  useConflictActions,
  wholeFileOnly,
} from "#web/features/working-changes/conflicts/hooks/use-conflicts";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import { describeFailure } from "#web/platform/query/request-failure";

interface MergeViewHandlers {
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
  readonly toolbarActions?: ReactNode;
}

export function MergeView({
  path,
  ...handlers
}: MergeViewHandlers & { readonly path: string }) {
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
      {...handlers}
    />
  );
}

function MergeViewContent({
  input,
  onOpen,
  onClose,
  toolbarActions,
}: MergeViewHandlers & { readonly input: ConflictPath }) {
  const merge = useMergeDocument(input);
  const [showBase, setShowBase] = useState(false);
  const leftSide: ConflictSide = showBase ? "base" : "current";
  const selection = useSelection(merge.model, merge.picks, merge.choose);
  const listed = merge.list.data?.files.find(({ path }) => path === input.path);
  const actions = useConflictActions(input, {
    revision: () => merge.revision() ?? listed?.revision,
    onResolved: (list: ConflictList) => {
      const next = list.files.find(
        ({ path, openRegions }) => path !== input.path && openRegions > 0,
      );
      if (next === undefined) onClose();
      else onOpen(next.path);
    },
  });
  const { loaded, model, picks } = merge;
  const document = merge.document.data;
  const failure = merge.document.error;
  const wholeFile = wholeFileOnly(failure);
  const panes =
    !wholeFile && loaded !== null && model !== null && document !== undefined;
  const confirming = actions.confirming === input.path;
  const notice =
    merge.notice ??
    actions.problem ??
    (failure !== null && !wholeFile ? describeFailure(failure) : null);
  const resolve = async (allowMarkers: boolean) => {
    await merge.settled();
    await actions.resolve(input.path, allowMarkers);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const key = keyAction(event);
    if (key === null || !event.currentTarget.contains(event.target as Node))
      return;
    event.preventDefault();
    if (key === "close") return confirming ? actions.cancel() : onClose();
    if (key === "previous") return selection.previous();
    if (key === "next") return selection.next();
    selection.takeActive(key);
  };

  return (
    <section
      aria-label="Merge view"
      className="flex h-full min-h-0 flex-col bg-repository"
      onKeyDown={onKeyDown}
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
            {openCount(model, picks)} of {regionSegments(model).length} open
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
          disabled={actions.busy}
          onChoose={async (choice) => {
            await merge.settled();
            await actions.choose(input.path, choice);
          }}
        />
        {panes &&
          (confirming ? (
            <Confirmation
              title="Conflict markers remain"
              action="Mark resolved anyway"
              busy={actions.busy}
              onCancel={actions.cancel}
              onConfirm={() => void resolve(true)}
              className="flex-nowrap"
            />
          ) : (
            <Button
              size="xs"
              disabled={actions.busy}
              onClick={() => void resolve(false)}
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
      {panes && merge.list.data && (
        <div className="flex min-h-0 flex-1 flex-col">
          <SidePanes
            loaded={loaded}
            sides={merge.list.data.sides}
            leftSide={leftSide}
            picks={picks}
            activeRegion={selection.activeRegion}
            lines={selection.lines}
            scrollRef={selection.sidesRef}
          />
          <ResultEditor
            model={model}
            picks={picks}
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

function keyAction(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "Escape") return "close";
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "ArrowDown") return "next";
  if (event.code === "Digit1") return "current";
  if (event.code === "Digit2") return "incoming";
  return null;
}

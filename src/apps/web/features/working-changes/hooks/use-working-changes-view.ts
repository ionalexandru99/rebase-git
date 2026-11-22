import { useState } from "react";
import type {
  ChangeSection,
  ChangeSelection,
  ChangesScope,
  MutateChanges,
  RepositoryChanges,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { useDiffPreferences } from "#web/features/file-diff/hooks/use-diff-preferences.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import {
  splitConflicts,
  useConflicts,
} from "#web/features/working-changes/conflicts/use-conflicts.ts";
import {
  type SelectedChange,
  useChangeSelection,
  viewedChange,
} from "#web/features/working-changes/hooks/use-change-selection.ts";
import {
  amendDraftKey,
  type CommitDraft,
  commitMessage,
  useCommitDraft,
} from "#web/features/working-changes/hooks/use-commit-draft.ts";
import { useDiscardUndo } from "#web/features/working-changes/hooks/use-discard-undo.ts";
import {
  type Amend,
  amendOff,
  useAmendHead,
  useChangeActions,
  useChangeDiff,
  useWorkingChanges,
} from "#web/features/working-changes/hooks/use-working-changes.ts";
import { useIgnorePaths } from "#web/features/working-changes/ignore-paths.tsx";
import type { ShowChangeInput } from "#web/features/working-changes/show-change.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";

const headMovedMessage = "HEAD changed while you were amending.";

export interface WorkingChangesTarget {
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly draftKey: string;
  readonly active: boolean;
  readonly requested?: ShowChangeInput | undefined;
}

export type ChangeAction = (
  action: MutateChanges["action"],
  section: ChangeSection,
  selection: ChangeSelection,
) => void;

export function useWorkingChangesView({
  repositoryId,
  worktreePath,
  draftKey,
  active,
  requested,
}: WorkingChangesTarget) {
  const [amend, setAmend] = useState<Amend>(amendOff);
  const errorToast = useErrorToast();
  const scope: ChangesScope = { repositoryId, worktreePath, amend: amend.on };
  const read = useWorkingChanges(scope, active);
  const shown = splitConflicts(read.data);
  const changes = read.isPlaceholderData ? undefined : shown.changes;
  const headMoved = () => errorToast.show("commit", headMovedMessage);
  const [selection, select] = useChangeSelection(
    shown.changes,
    shown.conflicted,
    changes === undefined ? undefined : requested,
  );
  const diff = useChangeDiff(scope, viewedChange(selection), changes, active);
  const conflicts = useConflicts(
    { repositoryId, worktreePath },
    shown.conflicted,
    selection?.section === "conflicts" ? selection.path : null,
    active,
  );
  const [preferences, choosePreferences] = useDiffPreferences();
  const actions = useChangeActions({ repositoryId, worktreePath });
  useAmendHead(
    amend,
    setAmend,
    read.isFetching || actions.busy ? undefined : changes,
    headMoved,
  );
  const amendKey =
    amend.on && amend.head !== undefined
      ? amendDraftKey(draftKey, amend.head)
      : undefined;
  const draft = useCommitDraft(
    amendKey ?? draftKey,
    amendKey === undefined ? undefined : changes?.message,
  );
  const loading =
    changes === undefined || (amend.on && amend.head === undefined);
  const busy = actions.busy || conflicts.busy;
  const ignore = useIgnorePaths(actions.ignore, {
    amend: scope.amend,
    ...viewing(selection),
  });
  const discardUndo = useDiscardUndo(async (discarded) => {
    const result = await actions.undoDiscard.run({
      amend: scope.amend,
      ...viewing(selection),
      discarded,
    });
    errorToast.failure("undoDiscard", result);
    return result._tag === "Ok";
  }, active);
  const begin = (): RepositoryChanges | undefined => {
    if (changes === undefined || busy || loading) return undefined;
    return changes;
  };

  const act: ChangeAction = async (action, section, selected) => {
    const current = begin();
    if (current === undefined) return;
    const result = await actions.mutate.run({
      amend: scope.amend,
      ...viewing(selection),
      revision: current.revision,
      action,
      section,
      selection:
        shown.conflicted.length > 0
          ? listedOnly(current, section, selected)
          : selected,
    });
    if (result._tag !== "Ok") return errorToast.failure(action, result);
    const { discarded } = result.value;
    if (discarded === null) return discardUndo.clear();
    discardUndo.add({
      discarded,
      paths: selectedPaths(current, section, selected),
      lines: selected._tag === "Lines",
    });
  };

  const commit = async () => {
    const current = begin();
    if (current === undefined) return;
    const amended = amend.on;
    const result = await actions.commit.run({
      amend: amended,
      ...viewing(selection),
      revision: current.revision,
      message: commitMessage(draft.draft),
    });
    if (result._tag !== "Ok") return errorToast.failure("commit", result);
    discardUndo.clear();
    draft.clear(
      amended ? [draftKey, amendDraftKey(draftKey, current.head)] : [draftKey],
    );
    setAmend(amendOff);
  };

  return {
    changes: shown.changes,
    conflicts,
    diff,
    selection,
    select,
    preferences,
    choosePreferences,
    amend: amend.on,
    toggleAmend: (on: boolean) => {
      if (!on) {
        if (!busy) setAmend(amendOff);
      } else if (begin() !== undefined) setAmend({ on: true });
    },
    draft: draft.draft,
    editDraft: (next: CommitDraft) => draft.edit(next),
    busy,
    loading,
    discardNotice: discardUndo.notice,
    error:
      conflicts.problem ??
      (read.isError ? describeFailure(read.error) : null) ??
      diff.error,
    refresh: () => {
      void read.refetch();
      if (diff.error) diff.retry();
      conflicts.refresh();
    },
    act,
    commit,
    ignore,
    scope,
    active,
  };
}

export type WorkingChangesView = ReturnType<typeof useWorkingChangesView>;

function viewing(selection: SelectedChange | null) {
  const viewed = viewedChange(selection);
  return viewed === null ? {} : { viewed };
}

function listedOnly(
  changes: RepositoryChanges,
  section: ChangeSection,
  selection: ChangeSelection,
): ChangeSelection {
  return selection._tag === "All"
    ? { _tag: "Files", paths: changes[section].map((file) => file.path) }
    : selection;
}

function selectedPaths(
  changes: RepositoryChanges,
  section: ChangeSection,
  selection: ChangeSelection,
) {
  if (selection._tag === "All")
    return changes[section].map((file) => file.path);
  return selection._tag === "Files" ? selection.paths : [selection.path];
}

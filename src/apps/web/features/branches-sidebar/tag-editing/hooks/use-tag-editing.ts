import type { RepositoryTag } from "@rebase/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  type BranchesSidebarRefRow,
  type BranchesSidebarRow,
  type RefRowAction,
  tagsSectionId,
} from "#web/features/branches-sidebar/branches-sidebar-model";
import type { RefCreateRequest } from "#web/features/branches-sidebar/hooks/use-create-ref-here";
import { useTagDeletion } from "#web/features/branches-sidebar/tag-editing/hooks/use-tag-deletion";
import { describeTagFailure } from "#web/features/branches-sidebar/tag-editing/tag-edit-messages";
import { useTagCommands } from "#web/features/tag-management/hooks/use-tag-commands";
import { tagNameProblem } from "#web/features/tag-management/tag-name";

export type TagEditing = ReturnType<typeof useTagEditing>;

export function useTagEditing({
  createRequest,
  focusTree,
  reveal,
  tags,
}: {
  readonly createRequest: RefCreateRequest | undefined;
  readonly focusTree: () => void;
  readonly reveal: (name: string, sectionId: string) => void;
  readonly tags: readonly RepositoryTag[];
}) {
  const commands = useTagCommands();
  const [draftOid, setDraftOid] = useState<string>();
  const deletion = useTagDeletion({ commands, focusTree });

  useEffect(() => {
    if (createRequest === undefined) return;
    setDraftOid(createRequest.kind === "tag" ? createRequest.oid : undefined);
  }, [createRequest]);

  const cancel = useCallback(() => {
    setDraftOid(undefined);
    focusTree();
  }, [focusTree]);

  const rowActions = (row: BranchesSidebarRefRow) =>
    tagRowActions(row, commands !== null);

  const start = (id: string, row: BranchesSidebarRefRow) => {
    const action = rowActions(row).find((candidate) => candidate.id === id);
    if (action === undefined || action.disabledReason !== undefined)
      return false;
    deletion.request(row.name);
    return true;
  };

  return {
    cancel,
    create: async (name: string) => {
      if (commands === null || draftOid === undefined) {
        cancel();
        return undefined;
      }
      const created = await commands.create(name, draftOid);
      if (created._tag === "Failed")
        return describeTagFailure(name, created.failure);
      setDraftOid(undefined);
      reveal(name, tagsSectionId);
      return undefined;
    },
    deletion,
    draftOid,
    draftSectionId: draftOid === undefined ? undefined : tagsSectionId,
    handleTreeKey: (key: string, row: BranchesSidebarRow | undefined) =>
      row?.kind === "ref" &&
      (key === "Delete" || key === "Backspace") &&
      start("deleteTag", row),
    nameProblem: (name: string) => tagNameProblem(name, tags),
    rowActions,
    start,
  };
}

function tagRowActions(
  row: BranchesSidebarRefRow,
  writable: boolean,
): readonly RefRowAction<"deleteTag">[] {
  if (row.target._tag !== "Tag") return [];
  return [
    {
      group: "delete",
      id: "deleteTag",
      label: "Delete tag",
      shortcut: "Del",
      ...(writable ? {} : { disabledReason: "Read only" }),
    },
  ];
}

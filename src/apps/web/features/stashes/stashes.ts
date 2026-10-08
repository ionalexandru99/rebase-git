import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { RouteFailure } from "#contracts/environment-connection/environment-route.contract.ts";
import type { ChangeSection } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type RepositoryStash,
  RepositoryStashesApi,
  type StashRejected,
} from "#contracts/repository-stashes/repository-stashes.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import {
  useErrorToast,
  useStatusToast,
} from "#web/features/notifications/notifications.tsx";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import type { FailureMessages } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

export interface StashSelection {
  readonly revision: string;
  readonly section: ChangeSection;
  readonly paths: readonly string[];
}

export interface StashInput {
  readonly _tag: "Stash";
  readonly oid: string;
}

type StashFailure =
  | RouteFailure<typeof RepositoryStashesApi.apply>
  | RouteFailure<typeof RepositoryStashesApi.save>;

const stashFailureMessages: FailureMessages<StashFailure> = {
  StashMissing: () => "This stash no longer exists.",
  StashRejected: ({ reason }) => rejectionMessage(reason),
};

const draftListeners = new Set<(selection: StashSelection) => void>();

export function isStashInput(input: unknown): input is StashInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "_tag" in input &&
    input._tag === "Stash" &&
    "oid" in input &&
    typeof input.oid === "string"
  );
}

function requestStashDraft(selection: StashSelection) {
  for (const listener of draftListeners) listener(selection);
  return draftListeners.size > 0;
}

export function useStashDraft() {
  const [selection, setSelection] = useState<StashSelection>();
  useEffect(() => {
    draftListeners.add(setSelection);
    return () => {
      draftListeners.delete(setSelection);
    };
  }, []);
  const cancel = () => setSelection(undefined);
  return { selection, cancel };
}

export function useStashes() {
  const scope = useRepositoryScope();
  const list = useEnvironmentQuery(
    RepositoryStashesApi.list,
    scope === undefined
      ? skipToken
      : { repositoryId: scope.repositoryId, worktreePath: scope.worktreePath },
    { changes: "refs" },
  );
  return list.data?.stashes ?? noStashes;
}

const noStashes: readonly RepositoryStash[] = [];

export function useStashMenu() {
  const stashes = useStashes();
  const commands = useStashCommands();
  const { refs } = useScopedRepositoryRefs();
  const worktreePath = useRepositoryScope()?.worktreePath;
  const branch =
    refs === undefined || worktreePath === undefined
      ? undefined
      : activeHead(refs, worktreePath)?.branch;
  return (selection: StashSelection | undefined): Action => {
    const enabled = selection !== undefined && commands.writable;
    const store = (into: RepositoryStash | undefined) => {
      if (selection !== undefined) void commands.store(selection, into);
    };
    return submenu({ id: "stash", label: "Stash", group: "operation" }, [
      {
        id: "stash.new",
        label: "New stash",
        enabled,
        run: () => {
          if (selection !== undefined && !requestStashDraft(selection))
            store(undefined);
        },
      },
      ...stashesForMenu(stashes, branch).map(
        (stash): Action => ({
          id: `stash.${stash.oid}`,
          label: stash.name,
          enabled,
          group: "edit",
          run: () => store(stash),
        }),
      ),
    ]);
  };
}

function stashesForMenu(
  stashes: readonly RepositoryStash[],
  branch: string | undefined,
) {
  return [
    ...stashes.filter((stash) => stash.branch === branch),
    ...stashes.filter((stash) => stash.branch !== branch),
  ];
}

export type StashCommands = ReturnType<typeof useStashCommands>;

export function useStashCommands() {
  const apply = useCommand(RepositoryStashesApi.apply);
  const drop = useCommand(RepositoryStashesApi.drop);
  const save = useCommand(RepositoryStashesApi.save);
  const errorToast = useErrorToast();
  const statusToast = useStatusToast();
  const [dropping, setDropping] = useState<RepositoryStash>();
  const writable = useRepositoryScope()?.writable ?? false;

  const restore = async (
    stash: Pick<RepositoryStash, "oid" | "name">,
    restoreIndex: boolean,
    remove: boolean,
    restored = `${remove ? "Popped" : "Applied"} ${stash.name}`,
  ) => {
    const result = await apply.run({
      oid: stash.oid,
      restoreIndex,
      drop: remove,
    });
    if (result._tag !== "Ok") {
      errorToast.failure("applyStash", result, stashFailureMessages);
      return;
    }
    const { conflicts } = result.value;
    statusToast.success(
      "applyStash",
      conflicts === 0
        ? restored
        : `Applied ${stash.name} with conflicts in ${files(conflicts)}. The stash was kept.`,
    );
  };

  const confirmDrop = async () => {
    if (dropping === undefined) return;
    const result = await drop.run({ oid: dropping.oid });
    setDropping(undefined);
    if (result._tag !== "Ok")
      errorToast.failure("dropStash", result, stashFailureMessages);
    else statusToast.success("dropStash", `Dropped ${dropping.name}`);
  };

  const store = async (
    selection: StashSelection,
    into: RepositoryStash | undefined,
    name?: string,
  ) => {
    const result = await save.run({
      revision: selection.revision,
      section: selection.section,
      paths: selection.paths,
      into: into?.oid ?? null,
      ...(name === undefined ? {} : { name }),
    });
    if (result._tag !== "Ok") {
      errorToast.failure("stash", result, stashFailureMessages);
      return false;
    }
    statusToast.success(
      "stash",
      into === undefined
        ? `Stashed ${files(selection.paths.length)}`
        : `Added ${files(selection.paths.length)} to ${into.name}`,
    );
    return true;
  };

  const actionsFor = (stash: RepositoryStash): readonly Action[] => {
    const restoreAction = (id: "apply" | "pop", label: string): Action =>
      stash.staged
        ? submenu({ id, label, group: "operation" }, [
            {
              id: `${id}.index`,
              label: "Keep staged files staged",
              enabled: writable,
              run: () => void restore(stash, true, id === "pop"),
            },
            {
              id: `${id}.unstaged`,
              label: "Unstage everything",
              enabled: writable,
              run: () => void restore(stash, false, id === "pop"),
            },
          ])
        : {
            id,
            label,
            enabled: writable,
            group: "operation",
            run: () => void restore(stash, false, id === "pop"),
          };
    return [
      restoreAction("apply", "Apply"),
      restoreAction("pop", "Pop"),
      {
        id: "drop",
        label: "Drop…",
        keys: ["Delete"],
        enabled: writable,
        group: "delete",
        run: () => setDropping(stash),
      },
    ];
  };

  return {
    writable,
    actionsFor,
    restore,
    store,
    saving: save.running,
    dropping: {
      stash: dropping,
      busy: drop.running,
      confirm: () => void confirmDrop(),
      cancel: () => setDropping(undefined),
    },
  };
}

function rejectionMessage(reason: StashRejected["reason"]) {
  switch (reason) {
    case "LocalChanges":
      return "Your changes to some of these files would be overwritten. Commit or stash them first.";
    case "IndexConflict":
      return "The staged changes can't be restored here. Try Unstage everything.";
    case "DoesNotFit":
      return "These changes overlap what that stash already holds. Nothing was stashed.";
    case "Unborn":
      return "Make a first commit before stashing.";
  }
}

function files(count: number) {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

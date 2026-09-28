import { useEffect, useRef } from "react";
import type {
  BranchUpstream,
  LocalBranch,
  RemoteBranch,
  RepositoryRefs,
  RepositoryRefTarget,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import type {
  RefDeletion,
  RefEditing,
} from "#web/features/refs/ref-editing.ts";
import type { RefKind, StartPoint } from "#web/features/refs/ref-kinds.ts";

export type RefIntent =
  | { readonly _tag: "DraftRef"; readonly kind: RefKind; readonly oid: string }
  | { readonly _tag: "FocusRefs" }
  | {
      readonly _tag: "RunRefAction";
      readonly target: RepositoryRefTarget;
      readonly id: RefAction["id"];
    };

type RefIntentListener = (intent: RefIntent) => void;

const intentListeners = new Set<RefIntentListener>();

export function requestRefIntent(intent: RefIntent) {
  for (const listener of intentListeners) listener(intent);
}

export function useRefIntent(handle: RefIntentListener) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    const listener: RefIntentListener = (intent) => latest.current(intent);
    intentListeners.add(listener);
    return () => {
      intentListeners.delete(listener);
    };
  }, []);
}

export interface RefActionRow {
  readonly id: string;
  readonly name: string;
  readonly target: RepositoryRefTarget;
  readonly upstream?: BranchUpstream;
}

export type RefAction = Action<
  | "checkout"
  | "merge"
  | "rebase"
  | "pull"
  | "showReflog"
  | "newBranch"
  | "rename"
  | "upstream"
  | "delete"
  | "deleteRemote"
  | "deleteBoth"
  | "deleteTag"
  | "deleteTagBoth"
  | `deleteTagOn:${string}`
  | `pushTag:${string}`
>;

export interface RefActionAccess {
  readonly activeWorktreePath: string;
  readonly writable: boolean;
}

export interface RefActionHandlers {
  readonly checkout: (target: RepositoryRefTarget) => void;
  readonly merge?:
    | ((target: RepositoryRefTarget) => RefAction | undefined)
    | undefined;
  readonly rebase?:
    | ((target: RepositoryRefTarget) => RefAction | undefined)
    | undefined;
  readonly showReflog?: ((branch: string) => void) | undefined;
  readonly pull:
    | { readonly pulling: boolean; readonly run: (branch: string) => void }
    | undefined;
  readonly pushTags: TagPushHandler | undefined;
  readonly editing: Pick<RefEditing, "draft" | "change"> & {
    readonly deletion: Pick<RefEditing["deletion"], "request">;
  };
}

export interface TagPushHandler {
  readonly pushing: boolean;
  readonly run: (tags: readonly string[], remote: string) => void;
}

export function refActions(
  row: RefActionRow,
  refs: RepositoryRefs,
  { activeWorktreePath, writable }: RefActionAccess,
  {
    checkout,
    merge,
    rebase,
    pull,
    pushTags,
    showReflog,
    editing,
  }: RefActionHandlers,
): readonly RefAction[] {
  const readOnly = writable ? undefined : "Read only";
  const target = row.target;
  const startPoint = refStartPoint(target, refs);
  const mergeAction = merge?.(target);
  const rebaseAction = rebase?.(target);
  const remove = (
    fields: Omit<ActionFields, "group" | "run">,
    deletion: RefDeletion | undefined,
  ) =>
    action({
      ...fields,
      group: "delete",
      run: () => {
        if (deletion !== undefined) editing.deletion.request(deletion);
      },
    });
  const deleteOnRemote = (remote: RemoteBranch | undefined) => {
    if (remote === undefined) return [];
    const branch = targeted(remote);
    return [
      remove(
        {
          id: "deleteRemote",
          label: `Delete on ${remote.remote}`,
          reason: readOnly,
        },
        branch && { kind: "branch", remote: branch },
      ),
    ];
  };
  const common: readonly RefAction[] = [
    action({ id: "checkout", label: "Checkout", run: () => checkout(target) }),
    ...(mergeAction === undefined ? [] : [mergeAction]),
    ...(rebaseAction === undefined ? [] : [rebaseAction]),
    ...(pull === undefined ||
    target._tag !== "LocalBranch" ||
    row.upstream === undefined
      ? []
      : [
          {
            id: "pull",
            label: "Pull",
            enabled: !pull.pulling,
            run: () => pull.run(target.name),
          } satisfies RefAction,
        ]),
    ...(showReflog === undefined || target._tag !== "LocalBranch"
      ? []
      : [
          action({
            id: "showReflog",
            label: "Show reflog",
            run: () => showReflog(target.name),
          }),
        ]),
    action({
      id: "newBranch",
      label: "New branch from here…",
      group: "create",
      reason:
        readOnly ?? (startPoint === undefined ? "No commits yet" : undefined),
      run: () => {
        if (startPoint !== undefined) editing.draft("branch", startPoint);
      },
    }),
  ];
  if (target._tag === "Tag") {
    const tag = refs.tags.find(({ name }) => name === target.name);
    const object = tag?.object ?? tag?.target;
    const remotes = tagRemotes(refs);
    const only = remotes.length === 1 ? remotes[0] : undefined;
    const deletion = (
      local: boolean,
      remote: string | undefined,
    ): RefDeletion | undefined =>
      object === undefined
        ? undefined
        : {
            kind: "tag",
            name: target.name,
            ...(local ? { local: { object } } : {}),
            ...(remote === undefined ? {} : { remote: { remote, object } }),
          };
    return [
      ...common,
      ...pushTagActions([target.name], remotes, readOnly, pushTags),
      remove(
        {
          id: "deleteTag",
          label: "Delete local",
          reason: readOnly,
          keys: deleteKeys,
        },
        deletion(true, undefined),
      ),
      ...remotes.map((remote) =>
        remove(
          {
            id: `deleteTagOn:${remote}`,
            label: `Delete on ${remote}…`,
            reason: readOnly,
          },
          deletion(false, remote),
        ),
      ),
      ...(only === undefined
        ? []
        : [
            remove(
              { id: "deleteTagBoth", label: "Delete both…", reason: readOnly },
              deletion(true, only),
            ),
          ]),
    ];
  }
  if (target._tag === "RemoteBranch")
    return [...common, ...deleteOnRemote(remoteBranch(target, refs))];
  const branch = refs.branches.find(({ name }) => name === target.name);
  if (branch === undefined) return common;
  const elsewhere =
    branch.worktreePath !== undefined &&
    branch.worktreePath !== activeWorktreePath
      ? "In another worktree"
      : undefined;
  const checkedOut =
    readOnly ??
    elsewhere ??
    (branch.worktreePath === undefined ? undefined : "Checked out");
  const counterpart = trackedRemoteBranch(branch, refs);
  const local = targeted(branch);
  const remote = targeted(counterpart);
  return [
    ...common,
    action({
      id: "rename",
      label: "Rename…",
      group: "edit",
      reason: readOnly ?? elsewhere,
      keys: ["F2"],
      run: () => editing.change("rename", branch, row.id),
    }),
    action({
      id: "upstream",
      label: "Upstream…",
      group: "edit",
      reason: readOnly,
      run: () => editing.change("upstream", branch, row.id),
    }),
    remove(
      {
        id: "delete",
        label: "Delete local",
        reason: checkedOut,
        keys: deleteKeys,
      },
      local && { kind: "branch", local },
    ),
    ...deleteOnRemote(counterpart),
    ...(counterpart === undefined
      ? []
      : [
          remove(
            { id: "deleteBoth", label: "Delete both", reason: checkedOut },
            local && remote && { kind: "branch", local, remote },
          ),
        ]),
  ];
}

export function selectedTagActions(
  names: readonly string[],
  refs: RepositoryRefs,
  { writable }: Pick<RefActionAccess, "writable">,
  pushTags: TagPushHandler | undefined,
): readonly RefAction[] {
  return pushTagActions(
    names,
    tagRemotes(refs),
    writable ? undefined : "Read only",
    pushTags,
  );
}

function pushTagActions(
  names: readonly string[],
  remotes: readonly string[],
  readOnly: string | undefined,
  pushTags: TagPushHandler | undefined,
): readonly RefAction[] {
  const subject = names.length === 1 ? "" : ` ${names.length} tags`;
  const reason =
    readOnly ??
    (pushTags === undefined ? "Unavailable" : undefined) ??
    (pushTags?.pushing ? "Pushing" : undefined);
  if (remotes.length === 0)
    return [
      action({
        id: "pushTag:",
        label: `Push${subject}`,
        group: "edit",
        reason: "No remotes",
        run: () => undefined,
      }),
    ];
  return remotes.map((remote) =>
    action({
      id: `pushTag:${remote}`,
      label: `Push${subject} to ${remote}`,
      group: "edit",
      reason,
      run: () => pushTags?.run(names, remote),
    }),
  );
}

function tagRemotes(refs: RepositoryRefs): readonly string[] {
  return refs.remoteProviders?.map(({ remote }) => remote) ?? [];
}

export function createRefActions(
  oid: string,
  {
    connected,
    writable,
  }: { readonly connected: boolean; readonly writable: boolean },
): readonly Action[] {
  if (!writable) return [];
  return createHere.map(({ kind, label }) => ({
    id: `${kind}.createHere`,
    label,
    enabled: connected,
    run: () => requestRefIntent({ _tag: "DraftRef", kind, oid }),
  }));
}

const deleteKeys = ["Delete", "Backspace"];

const createHere: readonly {
  readonly kind: RefKind;
  readonly label: string;
}[] = [
  { kind: "branch", label: "Create branch here…" },
  { kind: "tag", label: "Create tag here…" },
];

interface ActionFields {
  readonly id: RefAction["id"];
  readonly label: string;
  readonly group?: Action["group"];
  readonly reason?: string | undefined;
  readonly keys?: readonly string[];
  readonly run: () => void;
}

function action({ reason, group, keys, ...fields }: ActionFields): RefAction {
  return {
    ...fields,
    enabled: reason === undefined,
    ...(reason === undefined ? {} : { reason }),
    ...(group === undefined ? {} : { group }),
    ...(keys === undefined ? {} : { keys }),
  };
}

function targeted<Ref extends { readonly target?: string | undefined }>(
  ref: Ref | undefined,
): (Ref & { readonly target: string }) | undefined {
  return ref?.target === undefined ? undefined : { ...ref, target: ref.target };
}

function refStartPoint(
  target: RepositoryRefTarget,
  refs: RepositoryRefs,
): StartPoint | undefined {
  switch (target._tag) {
    case "LocalBranch": {
      const oid = localBranch(target, refs)?.target;
      return oid === undefined
        ? undefined
        : { label: target.name, name: "", oid };
    }
    case "RemoteBranch": {
      const oid = remoteBranch(target, refs)?.target;
      return oid === undefined
        ? undefined
        : {
            label: `${target.remote}/${target.name}`,
            name: target.name,
            oid,
            track: { name: target.name, remote: target.remote },
          };
    }
    case "Tag": {
      const oid = refs.tags.find((tag) => tag.name === target.name)?.target;
      return oid === undefined
        ? undefined
        : { label: target.name, name: "", oid };
    }
  }
}

function localBranch(
  target: RepositoryRefTarget,
  refs: RepositoryRefs,
): LocalBranch | undefined {
  return target._tag === "LocalBranch"
    ? refs.branches.find((branch) => branch.name === target.name)
    : undefined;
}

function remoteBranch(
  target: RepositoryRefTarget,
  refs: RepositoryRefs,
): RemoteBranch | undefined {
  return target._tag === "RemoteBranch"
    ? refs.remoteBranches.find(
        ({ name, remote }) => remote === target.remote && name === target.name,
      )
    : undefined;
}

function trackedRemoteBranch(
  branch: LocalBranch,
  refs: RepositoryRefs,
): RemoteBranch | undefined {
  if (branch.upstream === undefined || branch.upstream.gone) return undefined;
  return refs.remoteBranches.find(
    ({ name, remote }) =>
      name === branch.name && `${remote}/${name}` === branch.upstream?.name,
  );
}

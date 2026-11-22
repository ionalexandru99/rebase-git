import type { MergeMode } from "#contracts/repository-operations/repository-operations.contract.ts";
import type {
  BranchUpstream,
  LocalBranch,
  RemoteBranch,
  RepositoryRefs,
  RepositoryRefTarget,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import type { RebaseActionId } from "#web/features/rebase/rebase-actions.ts";
import {
  type BranchTarget,
  type RefDeletion,
  upstreamBranch,
} from "#web/features/refs/ref-deletion.ts";
import type { RefEditing } from "#web/features/refs/ref-editing.ts";
import {
  commitStartPoint,
  type RefKind,
  type StartPoint,
} from "#web/features/refs/ref-kinds.ts";
import { refSource } from "#web/features/refs/repository-refs.ts";
import type { ResetActionId } from "#web/features/reset/reset-actions.tsx";
import {
  worktreeDrafts,
  worktreeName,
} from "#web/features/worktrees/worktree-draft.ts";
import { listenerBus } from "#web/lib/listener-bus.ts";

export type RefIntent =
  | { readonly _tag: "DraftRef"; readonly kind: RefKind; readonly oid: string }
  | {
      readonly _tag: "RunRefAction";
      readonly target: RepositoryRefTarget;
      readonly id: RefAction["id"];
    };

export const refIntents = listenerBus<RefIntent>();

export interface RefActionRow {
  readonly id: string;
  readonly name: string;
  readonly target: RepositoryRefTarget;
  readonly upstream?: BranchUpstream;
}

export type RefAction = Action<
  | "checkout"
  | "compare"
  | "merge"
  | `merge.${MergeMode}`
  | RebaseActionId
  | ResetActionId
  | "pull"
  | "showReflog"
  | "pullRequests"
  | "openPullRequest"
  | `openPullRequest:${number}`
  | "linkPullRequest"
  | "newBranch"
  | "newWorktree"
  | "rename"
  | "settle"
  | "delete"
  | "deleteLocal"
  | `deleteOn:${string}`
  | "deleteBoth"
  | "pushTags"
  | `pushTag:${string}`
>;

export interface RefActionAccess {
  readonly activeWorktreePath: string;
  readonly writable: boolean;
}

export interface RefActionHandlers {
  readonly checkout: (target: RepositoryRefTarget) => void;
  readonly compare: (target: RepositoryRefTarget) => RefAction | undefined;
  readonly merge: (target: RepositoryRefTarget) => RefAction | undefined;
  readonly rebase: (target: RepositoryRefTarget) => RefAction | undefined;
  readonly reset: (target: RepositoryRefTarget) => RefAction | undefined;
  readonly showReflog: (branch: string) => void;
  readonly pullRequests: (target: RepositoryRefTarget) => readonly RefAction[];
  readonly pull:
    | { readonly pulling: boolean; readonly run: (branch: string) => void }
    | undefined;
  readonly pushTags: TagPushHandler | undefined;
  readonly settle: (names: readonly string[], settled: boolean) => void;
  readonly editing: Pick<RefEditing, "draft" | "startRename"> & {
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
    compare,
    merge,
    rebase,
    reset,
    pull,
    pushTags,
    showReflog,
    pullRequests,
    settle,
    editing,
  }: RefActionHandlers,
): readonly RefAction[] {
  const readOnly = writable ? undefined : "Read only";
  const target = row.target;
  const startPoint = refStartPoint(target, refs);
  const mergeAction = merge(target);
  const rebaseAction = rebase(target);
  const resetAction = reset(target);
  const compareAction = compare(target);
  const pullRequestActions = pullRequests(target);
  const remove = (
    fields: Omit<ActionFields, "group" | "run">,
    deletion: RefDeletion | undefined,
  ) => deleteAction(fields, deletion, editing);
  const branch =
    target._tag === "LocalBranch"
      ? refs.branches.find(({ name }) => name === target.name)
      : undefined;
  const holder = branch?.worktreePath;
  const current = holder === activeWorktreePath;
  const common: readonly RefAction[] = [
    ...(current
      ? []
      : [
          action({
            id: "checkout",
            label:
              holder === undefined
                ? "Checkout"
                : `Switch to ${worktreeName(holder)}`,
            run: () => checkout(target),
          }),
        ]),
    ...(compareAction === undefined ? [] : [compareAction]),
    ...(pull === undefined ||
    target._tag !== "LocalBranch" ||
    row.upstream === undefined
      ? []
      : [pullAction(target.name, holder !== undefined, row.upstream, pull)]),
    ...(target._tag !== "LocalBranch"
      ? []
      : [
          action({
            id: "showReflog",
            label: "Show reflog",
            run: () => showReflog(target.name),
          }),
        ]),
    ...pullRequestActions,
    ...[mergeAction, rebaseAction, resetAction].filter(
      (operation) => operation !== undefined,
    ),
    action({
      id: "newBranch",
      label: "Create branch here…",
      group: "edit",
      reason:
        readOnly ?? (startPoint === undefined ? "No commits yet" : undefined),
      run: () => {
        if (startPoint !== undefined) editing.draft("branch", startPoint);
      },
    }),
    ...(holder !== undefined ||
    target._tag === "Tag" ||
    startPoint === undefined
      ? []
      : [
          action({
            id: "newWorktree",
            label: "Open in new worktree",
            group: "edit",
            reason: readOnly,
            run: () =>
              worktreeDrafts.emit({ name: target.name, start: startPoint }),
          }),
        ]),
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
      ...deleteMenu([
        remove(
          {
            id: "deleteLocal",
            label: "Local",
            reason: readOnly,
            keys: deleteKeys,
          },
          deletion(true, undefined),
        ),
        ...remotes.map((remote) =>
          remove(
            {
              id: `deleteOn:${remote}`,
              label: `On ${remote}…`,
              reason: readOnly,
            },
            deletion(false, remote),
          ),
        ),
        ...(only === undefined
          ? []
          : [
              remove(
                { id: "deleteBoth", label: "Both…", reason: readOnly },
                deletion(true, only),
              ),
            ]),
      ]),
    ];
  }
  if (target._tag === "RemoteBranch") {
    const remote = refs.remoteBranches.find(
      ({ name, remote }) => remote === target.remote && name === target.name,
    );
    const deletion = targeted(remote);
    return [
      ...common,
      ...deleteMenu(
        remote === undefined
          ? []
          : [
              remove(
                {
                  id: `deleteOn:${remote.remote}`,
                  label: `On ${remote.remote}`,
                  reason: readOnly,
                },
                deletion && {
                  kind: "branch",
                  branches: [{ remote: deletion }],
                },
              ),
            ],
      ),
    ];
  }
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
  return [
    ...common,
    action({
      id: "rename",
      label: "Rename…",
      group: "edit",
      reason: readOnly ?? elsewhere,
      keys: ["F2"],
      run: () => editing.startRename(branch, row.id),
    }),
    ...settleActions([branch], readOnly, settle),
    ...branchDeleteMenu([branch], refs, { checkedOut, readOnly }, editing),
  ];
}

export function selectedBranchActions(
  names: readonly string[],
  refs: RepositoryRefs,
  { writable }: Pick<RefActionAccess, "writable">,
  { editing, settle }: Pick<RefActionHandlers, "editing" | "settle">,
): readonly RefAction[] {
  const readOnly = writable ? undefined : "Read only";
  const selected = new Set(names);
  const branches = refs.branches.filter(({ name }) => selected.has(name));
  const checkedOut =
    readOnly ??
    (branches.some(({ worktreePath }) => worktreePath !== undefined)
      ? "Checked out"
      : undefined);
  return [
    ...settleActions(branches, readOnly, settle),
    ...branchDeleteMenu(branches, refs, { checkedOut, readOnly }, editing),
  ];
}

function settleActions(
  branches: readonly LocalBranch[],
  readOnly: string | undefined,
  settle: RefActionHandlers["settle"],
): readonly RefAction[] {
  if (branches.length === 0) return [];
  const active = branches.filter((branch) => branch.settled === undefined);
  const settled = active.length === 0;
  return [
    action({
      id: "settle",
      label: settled ? "Unsettle" : "Settle",
      group: "delete",
      reason: readOnly,
      run: () =>
        settle(
          (settled ? branches : active).map(({ name }) => name),
          !settled,
        ),
    }),
  ];
}

function branchDeleteMenu(
  branches: readonly LocalBranch[],
  refs: RepositoryRefs,
  {
    checkedOut,
    readOnly,
  }: {
    readonly checkedOut: string | undefined;
    readonly readOnly: string | undefined;
  },
  editing: RefActionHandlers["editing"],
): readonly RefAction[] {
  const pairs = branches.map((branch) => {
    const upstream = branch.upstream?.gone
      ? undefined
      : upstreamBranch(refs, branch.upstream?.name);
    return {
      branch,
      counterpart: upstream?.name === branch.name ? upstream : undefined,
    };
  });
  const remotes = [
    ...new Set(pairs.flatMap(({ counterpart }) => counterpart?.remote ?? [])),
  ];
  const deletion = (
    targets: readonly (BranchTarget | undefined)[],
  ): RefDeletion | undefined =>
    targets.length === 0 || targets.some((target) => target === undefined)
      ? undefined
      : { kind: "branch", branches: targets.filter(isDefined) };
  const remove = (
    fields: Omit<ActionFields, "group" | "run">,
    chosen: RefDeletion | undefined,
  ) => deleteAction(fields, chosen, editing);
  const both = (branch: LocalBranch, counterpart: RemoteBranch | undefined) => {
    const local = targeted(branch);
    const remote = targeted(counterpart);
    if (local === undefined || (counterpart !== undefined && !remote))
      return undefined;
    return remote === undefined ? { local } : { local, remote };
  };
  return deleteMenu([
    remove(
      {
        id: "deleteLocal",
        label: "Local",
        reason: checkedOut,
        keys: deleteKeys,
      },
      deletion(
        pairs.map(({ branch }) => {
          const local = targeted(branch);
          return local && { local };
        }),
      ),
    ),
    ...remotes.map((remote) =>
      remove(
        { id: `deleteOn:${remote}`, label: `On ${remote}`, reason: readOnly },
        deletion(
          pairs
            .filter(({ counterpart }) => counterpart?.remote === remote)
            .map(({ counterpart }) => {
              const target = targeted(counterpart);
              return target && { remote: target };
            }),
        ),
      ),
    ),
    ...(remotes.length === 1
      ? [
          remove(
            { id: "deleteBoth", label: "Both", reason: checkedOut },
            deletion(
              pairs.map(({ branch, counterpart }) => both(branch, counterpart)),
            ),
          ),
        ]
      : []),
  ]);
}

function pullAction(
  branch: string,
  checkedOut: boolean,
  { ahead, behind }: BranchUpstream,
  pull: NonNullable<RefActionHandlers["pull"]>,
): RefAction {
  const blocked = !checkedOut && ahead > 0 && behind > 0;
  return {
    id: "pull",
    label: checkedOut ? "Pull" : "Fast-forward",
    enabled: !pull.pulling && !blocked,
    ...(blocked ? { reason: "Diverged" } : {}),
    run: () => pull.run(branch),
  };
}

function deleteMenu(choices: readonly RefAction[]): readonly RefAction[] {
  const [first] = choices;
  if (first === undefined) return [];
  if (choices.length === 1) return [{ ...first, label: "Delete" }];
  return [submenu({ id: "delete", label: "Delete", group: "delete" }, choices)];
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
  const push = (remote: string, label: string) =>
    action({
      id: `pushTag:${remote}`,
      label,
      group: "edit",
      reason,
      run: () => pushTags?.run(names, remote),
    });
  const [only] = remotes;
  if (remotes.length === 1 && only !== undefined)
    return [push(only, `Push${subject} to ${only}`)];
  return [
    submenu(
      { id: "pushTags", label: `Push${subject}`, group: "edit" },
      remotes.map((remote) => push(remote, `To ${remote}`)),
    ),
  ];
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
  const [branch, tag] = createHere.map(({ kind, label }) => ({
    id: `${kind}.createHere`,
    label,
    group: "edit" as const,
    enabled: connected,
    run: () => refIntents.emit({ _tag: "DraftRef", kind, oid }),
  }));
  return [
    ...(branch === undefined ? [] : [branch]),
    {
      id: "worktree.createHere",
      label: "Create worktree here…",
      group: "edit",
      enabled: connected,
      run: () =>
        worktreeDrafts.emit({ name: "", start: commitStartPoint(oid) }),
    },
    ...(tag === undefined ? [] : [tag]),
  ];
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

function deleteAction(
  fields: Omit<ActionFields, "group" | "run">,
  deletion: RefDeletion | undefined,
  editing: RefActionHandlers["editing"],
) {
  return action({
    ...fields,
    group: "delete",
    run: () => {
      if (deletion !== undefined) editing.deletion.request(deletion);
    },
  });
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
  const source = refSource(refs, target);
  if (source === undefined) return undefined;
  if (target._tag !== "RemoteBranch")
    return { label: source.label, name: "", oid: source.commit };
  return {
    label: source.label,
    name: target.name,
    oid: source.commit,
    track: { name: target.name, remote: target.remote },
  };
}

function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}

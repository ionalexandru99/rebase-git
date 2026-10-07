import { Toast } from "@base-ui/react/toast";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { PersistentNotificationOutlet } from "#web/features/notifications/components/persistent-notification.tsx";
import {
  type NoticeChoice,
  type NoticeData,
  NotificationStack,
  type NotifiedRepository,
} from "#web/features/notifications/notification-stack.tsx";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import {
  describeFailure,
  type FailureMessages,
  type RequestFailure,
  rejection,
  type TaggedFailure,
} from "#web/platform/query/request-failure.ts";

const errorTitles = {
  checkout: "Couldn't switch branches",
  createBranch: "Couldn't create the branch",
  createTag: "Couldn't create the tag",
  renameBranch: "Couldn't rename the branch",
  deleteBranch: "Couldn't delete the branch",
  settleBranches: "Couldn't update the settled branches",
  linkPullRequest: "Couldn't link the pull request",
  unlinkPullRequest: "Couldn't unlink the pull request",
  deleteTag: "Couldn't delete the tag",
  restoreBranch: "Couldn't restore the branch",
  pushTags: "Couldn't push tags",
  push: "Couldn't push",
  fetch: "Couldn't fetch",
  pull: "Couldn't pull",
  merge: "Couldn't merge",
  rebase: "Couldn't start the rebase",
  cherryPick: "Couldn't cherry-pick",
  reset: "Couldn't reset the branch",
  revert: "Couldn't revert the commit",
  restore: "Couldn't restore the files",
  copySha: "Couldn't copy the commit SHA",
  copySubject: "Couldn't copy the commit subject",
  copyPath: "Couldn't copy the path",
  copy: "Couldn't copy to the clipboard",
  showInGraph: "Couldn't show the commit in the graph",
  compare: "Couldn't compare the commits",
  openSearchResult: "Couldn't open the search result",
  stage: "Couldn't stage the changes",
  unstage: "Couldn't unstage the changes",
  discard: "Couldn't discard the changes",
  undoDiscard: "Couldn't undo the discard",
  ignore: "Couldn't ignore the files",
  commit: "Couldn't commit",
  stash: "Couldn't stash the changes",
  applyStash: "Couldn't apply the stash",
  dropStash: "Couldn't drop the stash",
  removeWorktree: "Couldn't remove the worktree",
  unlockWorktree: "Couldn't unlock the worktree",
  saveWorktreeFolder: "Couldn't save the worktree folder",
  resolveConflict: "Couldn't resolve the conflict",
  continue: "Couldn't continue the operation",
  skip: "Couldn't skip the commit",
  abort: "Couldn't abort the operation",
  openRepository: "Couldn't open the repository",
  revealRepository: "Couldn't reveal the repository",
  removeRepository: "Couldn't remove the repository",
  saveHistoryOrder: "Couldn't save the history order",
  saveFetchSettings: "Couldn't save automatic fetch",
  saveBranchSettings: "Couldn't save the branch settings",
  savePullStrategy: "Couldn't save the pull setting",
  saveFetchPrune: "Couldn't save the branch removal setting",
  saveCloneFolder: "Couldn't save the clone folder",
  saveDiffSettings: "Couldn't save the diff settings",
  clearCache: "Couldn't clear the cache",
  rebuildCache: "Couldn't rebuild the cache",
  refreshRepository: "Couldn't refresh the repository view",
  clearHistory: "Couldn't clear the repository history",
  clearAllHistory: "Couldn't clear all history",
  checkUpdates: "Couldn't check for updates",
  installUpdate: "Couldn't install the update",
  saveUpdateSettings: "Couldn't save the update settings",
  saveSourceControl: "Couldn't save the source control settings",
  openTerminal: "Couldn't open a terminal",
} as const;

export type ErrorAction = keyof typeof errorTitles;

export type ErrorToast = ReturnType<typeof useErrorToast>;

const visibleToasts = 3;

const unanswered =
  "The server stopped responding. Reconnect and check the result before trying again.";

type Notice = {
  readonly type: "error" | "success" | "loading";
  readonly title: string;
  readonly description?: string | undefined;
  readonly percent?: number | undefined;
  readonly action?: { readonly label: string; readonly run: () => void };
  readonly choices?: NoticeData["choices"];
};

type ProgressOptions = {
  readonly cancel?: () => void;
  readonly percent?: number;
};

function useActionToasts() {
  const { add, close, update, toasts } = Toast.useToastManager<NoticeData>();
  const shown = useRef(toasts);
  useLayoutEffect(() => {
    shown.current = toasts;
  });
  const repositoryId = useRepositoryScope()?.repositoryId;
  const idFor = (action: ErrorAction) => `${repositoryId ?? ""}/${action}`;
  return {
    put: (action: ErrorAction, notice: Notice) => {
      const id = idFor(action);
      const button = notice.action;
      const previous = shown.current.find((toast) => toast.id === id);
      const percent =
        notice.type === "success" &&
        previous?.type === "loading" &&
        previous.data?.percent !== undefined
          ? 100
          : notice.percent;
      if (
        previous !== undefined &&
        previous.type !== "loading" &&
        previous.data?.choices === undefined
      )
        close(id);
      add({
        id,
        type: notice.type,
        timeout: notice.choices === undefined ? undefined : 0,
        title: notice.title,
        description: notice.description ?? "",
        actionProps:
          button === undefined
            ? {}
            : {
                children: button.label,
                onClick: () => {
                  close(id);
                  button.run();
                },
              },
        data: {
          repositoryId,
          ...(percent === undefined ? {} : { percent }),
          ...(notice.choices === undefined ? {} : { choices: notice.choices }),
        },
      });
    },
    advance: (action: ErrorAction, percent: number) =>
      update(idFor(action), { data: { repositoryId, percent } }),
    close: (action: ErrorAction) => close(idFor(action)),
  };
}

const OpenGitIdentity = createContext<() => void>(() => {});

export function useErrorToast() {
  const toasts = useActionToasts();
  const openGitIdentity = useContext(OpenGitIdentity);
  const show = (
    action: ErrorAction,
    description?: string,
    button?: Notice["action"],
  ) =>
    toasts.put(action, {
      type: "error",
      title: errorTitles[action],
      description,
      ...(button === undefined ? {} : { action: button }),
    });
  return {
    show,
    failure: <Failure extends TaggedFailure>(
      action: ErrorAction,
      result: { readonly _tag: "Ok" } | RequestFailure<Failure>,
      messages?: FailureMessages<Failure>,
      undo?: () => void,
    ) => {
      if (result._tag === "Ok") return;
      if (result._tag === "Cancelled") {
        toasts.close(action);
        return;
      }
      show(
        action,
        result._tag === "Unanswered"
          ? unanswered
          : describeFailure(result, messages),
        identityMissing(result)
          ? { label: "Open settings", run: openGitIdentity }
          : undo === undefined
            ? undefined
            : { label: "Undo", run: undo },
      );
    },
  };
}

export type StatusToast = ReturnType<typeof useStatusToast>;

export function useStatusToast() {
  const toasts = useActionToasts();
  return {
    progress: (
      action: ErrorAction,
      title: string,
      { cancel, percent }: ProgressOptions = {},
    ) => {
      askToNotifyFromTheBackground();
      toasts.put(action, {
        type: "loading",
        title,
        percent,
        ...(cancel === undefined
          ? {}
          : { action: { label: "Cancel", run: cancel } }),
      });
    },
    advance: toasts.advance,
    success: (action: ErrorAction, title: string, undo?: () => void) =>
      toasts.put(action, {
        type: "success",
        title,
        ...(undo === undefined ? {} : { action: { label: "Undo", run: undo } }),
      }),
    warning: (action: ErrorAction, title: string, description: string) =>
      toasts.put(action, { type: "error", title, description }),
    choose: (
      action: ErrorAction,
      title: string,
      choices: readonly [NoticeChoice, ...NoticeChoice[]],
    ) => toasts.put(action, { type: "error", title, choices }),
    close: toasts.close,
  };
}

function askToNotifyFromTheBackground() {
  if (
    typeof Notification !== "undefined" &&
    Notification.permission === "default"
  )
    void Notification.requestPermission();
}

export function NotificationsProvider({
  repositories,
  currentRepositoryId,
  openRepository,
  openGitIdentity,
  children,
}: {
  readonly repositories: readonly NotifiedRepository[];
  readonly currentRepositoryId: string | undefined;
  readonly openRepository: (repositoryId: string) => void;
  readonly openGitIdentity: () => void;
  readonly children: ReactNode;
}) {
  const [outlet, setOutlet] = useState<HTMLDivElement | null>(null);
  return (
    <Toast.Provider timeout={8_000} limit={visibleToasts}>
      <OpenGitIdentity.Provider value={openGitIdentity}>
        <PersistentNotificationOutlet.Provider value={outlet}>
          {children}
          <NotificationStack
            currentRepositoryId={currentRepositoryId}
            openRepository={openRepository}
            persistentOutlet={setOutlet}
            repositories={repositories}
          />
        </PersistentNotificationOutlet.Provider>
      </OpenGitIdentity.Provider>
    </Toast.Provider>
  );
}

function identityMissing(result: RequestFailure<TaggedFailure>) {
  const failure = rejection(result);
  return (
    failure?._tag === "RepositoryRejected" &&
    "reason" in failure &&
    failure.reason === "IdentityMissing"
  );
}

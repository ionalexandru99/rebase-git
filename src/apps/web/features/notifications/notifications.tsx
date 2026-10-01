import { Toast } from "@base-ui/react/toast";
import { IconAlertCircle, IconX } from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { PersistentNotificationOutlet } from "#web/features/notifications/components/persistent-notification.tsx";
import {
  describeFailure,
  type FailureMessages,
  type RequestFailure,
  type TaggedFailure,
} from "#web/platform/query/request-failure.ts";

const errorTitles = {
  checkout: "Couldn’t switch branches",
  createBranch: "Couldn’t create the branch",
  createTag: "Couldn’t create the tag",
  renameBranch: "Couldn’t rename the branch",
  deleteBranch: "Couldn’t delete the branch",
  deleteTag: "Couldn’t delete the tag",
  restoreBranch: "Couldn’t restore the branch",
  pushTags: "Couldn’t push tags",
  push: "Couldn’t push changes",
  fetch: "Couldn’t fetch changes",
  pull: "Couldn’t pull changes",
  merge: "Couldn’t merge",
  rebase: "Couldn’t start the rebase",
  cherryPick: "Couldn’t cherry-pick",
  reset: "Couldn’t reset the branch",
  revert: "Couldn’t revert the commit",
  copySha: "Couldn’t copy the commit SHA",
  copySubject: "Couldn’t copy the commit subject",
  copyPath: "Couldn’t copy the path",
  copy: "Couldn’t copy to the clipboard",
  showInGraph: "Couldn’t show the commit in the graph",
  openSearchResult: "Couldn’t open the search result",
  stage: "Couldn’t stage the changes",
  unstage: "Couldn’t unstage the changes",
  discard: "Couldn’t discard the changes",
  commit: "Couldn’t commit",
  resolveConflict: "Couldn’t resolve the conflict",
  continue: "Couldn’t continue the operation",
  skip: "Couldn’t skip the commit",
  abort: "Couldn’t abort the operation",
  openRepository: "Couldn’t open the repository",
  revealRepository: "Couldn’t reveal the repository",
  removeRepository: "Couldn’t remove the repository",
  saveHistoryOrder: "Couldn’t save the history ordering",
  saveFetchSettings: "Couldn’t save automatic fetch",
  saveDiffSettings: "Couldn’t save the diff settings",
  clearCache: "Couldn’t clear the cache",
  rebuildCache: "Couldn’t rebuild the cache",
  refreshRepository: "Couldn’t refresh the repository view",
  clearHistory: "Couldn’t clear the repository history",
  clearAllHistory: "Couldn’t clear all history",
  checkUpdates: "Couldn’t check for updates",
  installUpdate: "Couldn’t install the update",
  saveUpdateSettings: "Couldn’t save the update settings",
} as const;

export type ErrorAction = keyof typeof errorTitles;

export type ErrorToast = ReturnType<typeof useErrorToast>;

const visibleToasts = 3;

const unanswered =
  "The server stopped responding. Reconnect and check the result before trying again.";

export function useErrorToast() {
  const { add } = Toast.useToastManager();
  return useMemo(() => {
    const show = (action: ErrorAction, description?: string) => {
      add({
        title: errorTitles[action],
        ...(description === undefined ? {} : { description }),
      });
    };
    return {
      show,
      failure: <Failure extends TaggedFailure>(
        action: ErrorAction,
        result: { readonly _tag: "Ok" } | RequestFailure<Failure>,
        messages?: FailureMessages<Failure>,
      ) => {
        if (result._tag === "Ok" || result._tag === "Cancelled") return;
        show(
          action,
          result._tag === "Unanswered"
            ? unanswered
            : describeFailure(result, messages),
        );
      },
    };
  }, [add]);
}

export function NotificationsProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [outlet, setOutlet] = useState<HTMLDivElement | null>(null);
  return (
    <Toast.Provider timeout={8_000} limit={visibleToasts}>
      <PersistentNotificationOutlet.Provider value={outlet}>
        {children}
        <Notifications persistentOutlet={setOutlet} />
      </PersistentNotificationOutlet.Provider>
    </Toast.Provider>
  );
}

function Notifications({
  persistentOutlet,
}: {
  readonly persistentOutlet: (element: HTMLDivElement | null) => void;
}) {
  const { toasts, close } = Toast.useToastManager();
  useEffect(() => {
    for (const toast of toasts)
      if (toast.limited && toast.transitionStatus !== "ending") close(toast.id);
  }, [toasts, close]);
  return (
    <Toast.Portal>
      <Toast.Viewport className="pointer-events-none fixed top-14 right-4 z-100 flex w-[calc(100%-2rem)] max-w-90 flex-col gap-2 outline-none">
        <div ref={persistentOutlet} className="empty:hidden" />
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className="pointer-events-auto shrink-0 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none data-ending-style:hidden data-limited:hidden"
          >
            <Toast.Content className="flex items-start gap-3 px-3 py-2.5">
              <IconAlertCircle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-status-unavailable"
              />
              <div className="min-w-0 flex-1">
                <Toast.Title className="text-sm font-medium" />
                <Toast.Description className="mt-1 max-h-[min(240px,40vh)] overflow-y-auto whitespace-pre-line wrap-anywhere text-sm text-muted-foreground empty:hidden" />
              </div>
              <Toast.Close
                aria-hidden={false}
                aria-label="Dismiss notification"
                render={<Button size="icon-xs" variant="ghost" />}
              >
                <IconX aria-hidden="true" />
              </Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

import { IconAlertCircle, IconCircleFilled } from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef } from "react";
import {
  ErrorNotification,
  PersistentNotification,
} from "#web/features/notifications/index";
import type { ForcePushReview } from "#web/features/repository-push/repository-push.contract";
import { destinationName } from "#web/features/repository-push/resolve-push-target";
import { Button } from "#web-ui/components/ui/button";
import { useRepositoryPush } from "#web-ui/features/repository-push/repository-push-provider";

export function PushNotice() {
  const push = useRepositoryPush();
  if (push === null) return null;
  const { controller, state } = push;
  if (state.running !== null)
    return (
      <PushToast
        label="Push progress"
        title={state.running.message}
        onEscape={controller.cancel}
        actions={
          <Button size="xs" variant="ghost" onClick={controller.cancel}>
            Cancel
          </Button>
        }
      />
    );
  if (state.review !== null)
    return (
      <ForcePushToast
        review={state.review}
        disabled={!state.connected}
        cancel={controller.cancel}
        confirm={controller.confirm}
      />
    );
  if (state.notice !== null)
    return <ErrorNotification message={state.notice} />;
  return null;
}

function ForcePushToast({
  review,
  disabled,
  cancel,
  confirm,
}: {
  readonly review: ForcePushReview;
  readonly disabled: boolean;
  readonly cancel: () => void;
  readonly confirm: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelButton.current?.focus();
  }, []);
  const name = destinationName(review.destination);
  const tip = <Oid>{review.expectedOid.slice(0, 8)}</Oid>;
  return (
    <PushToast
      label="Confirm force push"
      title={`Force push to ${name}?`}
      tone="warning"
      onEscape={cancel}
      actions={
        <>
          <Button ref={cancelButton} size="xs" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            size="xs"
            variant="destructive"
            disabled={disabled}
            onClick={confirm}
          >
            Force push
          </Button>
        </>
      }
    >
      Overwrites {tip}
      {review.removed > 0 ? (
        <span className="text-destructive">
          {" "}
          · drops {review.removed} remote{" "}
          {review.removed === 1 ? "commit" : "commits"}
        </span>
      ) : null}
    </PushToast>
  );
}

function PushToast({
  label,
  title,
  tone = "progress",
  onEscape,
  actions,
  children,
}: {
  readonly label: string;
  readonly title: string;
  readonly tone?: "progress" | "warning";
  readonly onEscape: () => void;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <PersistentNotification>
      <section
        aria-label={label}
        className="pointer-events-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onEscape();
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          {tone === "warning" ? (
            <IconAlertCircle
              aria-hidden="true"
              className="size-4 shrink-0 text-status-connecting"
            />
          ) : (
            <IconCircleFilled
              aria-hidden="true"
              className="size-2 shrink-0 text-status-connecting"
            />
          )}
          <h2
            aria-live="polite"
            className="min-w-0 flex-1 wrap-anywhere text-xs font-semibold"
          >
            {title}
          </h2>
          {children === undefined ? actions : null}
        </div>
        {children === undefined ? null : (
          <div className="flex flex-col gap-2 border-border border-t px-3 py-2 text-xs">
            <div className="text-muted-foreground">{children}</div>
            {actions === undefined ? null : (
              <div className="flex justify-end gap-2">{actions}</div>
            )}
          </div>
        )}
      </section>
    </PersistentNotification>
  );
}

function Oid({ children }: { readonly children: ReactNode }) {
  return <span className="font-mono text-foreground">{children}</span>;
}

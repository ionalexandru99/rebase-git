import { IconCircleFilled } from "@tabler/icons-react";
import { Button } from "#web/components/ui/button";
import { Confirmation } from "#web/components/ui/confirmation";
import { ErrorNotification } from "#web/features/notifications/components/error-notification";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification";
import type {
  ForcePushReview,
  Push,
} from "#web/features/repository-push/hooks/use-push";
import { destinationName } from "#web/features/repository-push/resolve-push-target";

export function PushNotice({ push }: { readonly push: Push }) {
  if (push.running !== null)
    return <PushProgress title={push.running} cancel={push.cancel} />;
  if (push.review !== null)
    return (
      <PersistentNotification>
        <ForcePushConfirmation
          review={push.review}
          disabled={!push.connected}
          cancel={push.cancel}
          confirm={push.confirm}
        />
      </PersistentNotification>
    );
  if (push.notice !== null) return <ErrorNotification message={push.notice} />;
  return null;
}

function ForcePushConfirmation({
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
  return (
    <Confirmation
      title={`Force push to ${destinationName(review.destination)}?`}
      action="Force push"
      busy={disabled}
      onCancel={cancel}
      onConfirm={confirm}
      className="px-3 py-2"
    >
      Overwrites{" "}
      <span className="font-mono text-foreground">
        {review.expectedOid.slice(0, 8)}
      </span>
      {review.removed > 0 ? (
        <span className="text-destructive">
          {" "}
          · drops {review.removed} remote{" "}
          {review.removed === 1 ? "commit" : "commits"}
        </span>
      ) : null}
    </Confirmation>
  );
}

function PushProgress({
  title,
  cancel,
}: {
  readonly title: string;
  readonly cancel: () => void;
}) {
  return (
    <PersistentNotification>
      <section
        aria-label="Push progress"
        className="flex items-center gap-2 px-3 py-2 outline-none"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          cancel();
        }}
      >
        <IconCircleFilled
          aria-hidden="true"
          className="size-2 shrink-0 text-status-connecting"
        />
        <h2
          aria-live="polite"
          className="min-w-0 flex-1 wrap-anywhere text-xs font-semibold"
        >
          {title}
        </h2>
        <Button size="xs" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </section>
    </PersistentNotification>
  );
}

import { IconAlertTriangle, IconCircleFilled } from "@tabler/icons-react";
import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { Button } from "#web/components/ui/button.tsx";
import { useConfirmation } from "#web/components/ui/confirmation.tsx";
import { NoticeCard } from "#web/features/notifications/components/notice-card.tsx";
import type { ErrorAction } from "#web/features/notifications/notifications.tsx";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export const PersistentNotificationOutlet = createContext<HTMLElement | null>(
  null,
);

export function noticeId(repositoryId: string | undefined, action: string) {
  return `${repositoryId ?? ""}/${action}`;
}

export function confirmsInPlace(outlet: HTMLElement | null, id: string) {
  return (
    outlet !== null &&
    outlet.querySelector(`[data-notice="${CSS.escape(id)}"]`) !== null
  );
}

export function PersistentNotification({
  children,
}: {
  readonly children: ReactNode;
}) {
  const outlet = useContext(PersistentNotificationOutlet);
  return outlet === null
    ? null
    : createPortal(
        <div
          data-notification
          className="pointer-events-auto elevation-menu empty:hidden"
        >
          {children}
        </div>,
        outlet,
      );
}

type ConfirmNoticeProps = {
  readonly notice: ErrorAction;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action: string;
  readonly busy?: string | undefined;
  readonly disabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onStop?: () => void;
};

export function ConfirmNotice(props: ConfirmNoticeProps) {
  return (
    <PersistentNotification>
      <ConfirmCard {...props} />
    </PersistentNotification>
  );
}

function ConfirmCard({
  notice,
  title,
  children,
  action,
  busy,
  disabled = false,
  onConfirm,
  onCancel,
  onStop,
}: ConfirmNoticeProps) {
  const repositoryId = useRepositoryScope()?.repositoryId;
  const running = busy !== undefined;
  const { root, cancel, onKeyDown } = useConfirmation(
    running ? onStop : onCancel,
  );
  return (
    <section
      ref={root}
      aria-busy={running}
      aria-label={title}
      className="px-3 py-2.5"
      data-notice={noticeId(repositoryId, notice)}
      onKeyDown={onKeyDown}
      role="alertdialog"
    >
      <NoticeCard
        icon={
          <IconAlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
        }
        heading={
          <p className="cap-centered text-control font-medium wrap-anywhere">
            {title}
          </p>
        }
        body={
          children === undefined || children === null ? null : (
            <div className="mt-1 text-body text-muted-foreground">
              {children}
            </div>
          )
        }
        actions={
          <>
            {running && onStop === undefined ? null : (
              <Button
                ref={cancel}
                onClick={running ? onStop : onCancel}
                size="xs"
                variant="ghost"
              >
                Cancel
              </Button>
            )}
            <Button
              disabled={running || disabled}
              focusableWhenDisabled={running}
              onClick={onConfirm}
              size="xs"
              variant="destructive"
            >
              {running ? (
                <>
                  <IconCircleFilled
                    aria-hidden="true"
                    className="size-2 text-warning"
                  />
                  {busy}
                </>
              ) : (
                action
              )}
            </Button>
          </>
        }
      />
    </section>
  );
}

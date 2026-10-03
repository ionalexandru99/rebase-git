import { Toast } from "@base-ui/react/toast";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconCircleFilled,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { Button } from "#web/components/ui/button.tsx";

export type NoticeData = {
  readonly repositoryId: string | undefined;
  readonly percent?: number;
};

export type NotifiedRepository = {
  readonly id: string;
  readonly name: string;
};

type NoticeObject = Toast.Root.ToastObject<NoticeData>;

const noticeClass = [
  "[--gap:0.5rem] [--peek:0.625rem] [--scale:calc(max(0,1-var(--toast-index)*0.06))] [--shrink:calc(1-var(--scale))] [--height:var(--toast-frontmost-height,var(--toast-height))]",
  "[--offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--gap)+var(--toast-swipe-movement-y))]",
  "[--stacked-y:calc(var(--toast-swipe-movement-y)+var(--toast-index)*var(--peek)+var(--shrink)*var(--height))]",
  "[--slide-out:calc(var(--toast-swipe-movement-x)+100%+1rem)]",
  "pointer-events-auto absolute top-0 right-0 z-[calc(1000-var(--toast-index))] h-(--height) w-full origin-top select-none rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none",
  "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
  "[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--stacked-y))_scale(var(--scale))]",
  "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
  "data-starting-style:[transform:translateX(calc(100%+1rem))]",
  "data-ending-style:opacity-0 data-ending-style:[transform:translateX(var(--slide-out))_translateY(var(--stacked-y))_scale(var(--scale))]",
  "data-expanded:data-ending-style:[transform:translateX(var(--slide-out))_translateY(var(--offset-y))]",
  "data-limited:pointer-events-none data-limited:opacity-0",
  "[transition:transform_0.4s_cubic-bezier(0.22,1,0.36,1),opacity_0.4s,height_0.15s] motion-reduce:[transition:opacity_0.2s]",
].join(" ");

export function NotificationStack({
  repositories,
  currentRepositoryId,
  openRepository,
  persistentOutlet,
}: {
  readonly repositories: readonly NotifiedRepository[];
  readonly currentRepositoryId: string | undefined;
  readonly openRepository: (repositoryId: string) => void;
  readonly persistentOutlet: (element: HTMLDivElement | null) => void;
}) {
  const { toasts } = Toast.useToastManager<NoticeData>();
  const repositoryOf = (toast: NoticeObject) =>
    repositories.find(({ id }) => id === toast.data?.repositoryId);
  useBackgroundNotifications(toasts, repositoryOf, openRepository);
  return (
    <Toast.Portal>
      <Toast.Viewport className="pointer-events-none fixed top-14 right-4 z-100 flex w-[calc(100%-2rem)] max-w-90 flex-col gap-2 outline-none">
        <div
          ref={persistentOutlet}
          className="flex flex-col gap-2 empty:hidden"
        />
        <div className="relative">
          {toasts.map((toast) => {
            const repository = repositoryOf(toast);
            return (
              <Notice
                key={toast.id}
                toast={toast}
                elsewhere={
                  repository?.id === currentRepositoryId
                    ? undefined
                    : repository
                }
                openRepository={openRepository}
              />
            );
          })}
        </div>
      </Toast.Viewport>
    </Toast.Portal>
  );
}

function Notice({
  toast,
  elsewhere,
  openRepository,
}: {
  readonly toast: NoticeObject;
  readonly elsewhere: NotifiedRepository | undefined;
  readonly openRepository: (repositoryId: string) => void;
}) {
  return (
    <Toast.Root toast={toast} swipeDirection="right" className={noticeClass}>
      <Toast.Content className="overflow-hidden px-3 py-2.5 transition-opacity duration-200 data-behind:opacity-0 data-expanded:opacity-100">
        <div className="flex items-start gap-3">
          <NoticeIcon
            type={toast.type}
            percent={toast.data?.percent}
            label={String(toast.title)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 text-sm">
              <Toast.Title className="min-w-0 font-medium wrap-anywhere" />
              {elsewhere === undefined ? null : (
                <>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  <span className="max-w-[40%] shrink-0 truncate text-muted-foreground">
                    {elsewhere.name}
                  </span>
                </>
              )}
            </div>
            <Toast.Description className="mt-1 max-h-[min(240px,40vh)] overflow-y-auto whitespace-pre-line wrap-anywhere text-sm text-muted-foreground" />
          </div>
          {toast.type === "loading" ? null : (
            <Toast.Close
              aria-hidden={false}
              aria-label="Dismiss notification"
              render={
                <Button
                  className="-my-1 sm:-my-0.5"
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <IconX aria-hidden="true" />
            </Toast.Close>
          )}
        </div>
        {toast.actionProps?.children === undefined &&
        elsewhere === undefined ? null : (
          <div className="mt-2.5 flex justify-end gap-1.5">
            {elsewhere === undefined ? null : (
              <Button
                aria-label={`Open ${elsewhere.name}`}
                onClick={() => openRepository(elsewhere.id)}
                size="xs"
                variant="ghost"
              >
                Open
              </Button>
            )}
            <Toast.Action render={<Button size="xs" variant="outline" />} />
          </div>
        )}
      </Toast.Content>
    </Toast.Root>
  );
}

function NoticeIcon({
  type,
  percent,
  label,
}: {
  readonly type: string | undefined;
  readonly percent: number | undefined;
  readonly label: string;
}) {
  if (type === "loading" && percent !== undefined)
    return <ProgressRing percent={percent} label={label} />;
  if (type === "loading")
    return (
      <span
        aria-hidden="true"
        className="flex h-5 w-4 shrink-0 items-center justify-center"
      >
        <IconCircleFilled className="size-2 text-status-connecting" />
      </span>
    );
  return type === "success" ? (
    <IconCircleCheck
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-status-available"
    />
  ) : (
    <IconAlertCircle
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-status-unavailable"
    />
  );
}

const ringRadius = 6;
const ringLength = 2 * Math.PI * ringRadius;

function ProgressRing({
  percent,
  label,
}: {
  readonly percent: number;
  readonly label: string;
}) {
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="mt-0.5 size-4 shrink-0 -rotate-90"
      viewBox="0 0 16 16"
    >
      <circle
        cx="8"
        cy="8"
        r={ringRadius}
        fill="none"
        strokeWidth="2"
        className="stroke-foreground/15"
      />
      <circle
        cx="8"
        cy="8"
        r={ringRadius}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={ringLength}
        strokeDashoffset={ringLength * (1 - percent / 100)}
        className="stroke-primary transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none"
      />
    </svg>
  );
}

function useBackgroundNotifications(
  toasts: readonly NoticeObject[],
  repositoryOf: (toast: NoticeObject) => NotifiedRepository | undefined,
  openRepository: (repositoryId: string) => void,
) {
  const announced = useRef(new Map<string, number>());
  useEffect(() => {
    const versions = new Map<string, number>();
    for (const toast of toasts) {
      const version = toast.updateKey ?? 0;
      versions.set(toast.id, version);
      if (announced.current.get(toast.id) === version) continue;
      if (toast.type === "loading" || !canNotifyFromTheBackground()) continue;
      const repository = repositoryOf(toast);
      const notification = new Notification(String(toast.title), {
        body: [repository?.name, firstLine(toast.description)]
          .filter((line) => typeof line === "string" && line !== "")
          .join("\n"),
        tag: toast.id,
      });
      notification.onclick = () => {
        notification.close();
        window.focus();
        if (repository !== undefined) openRepository(repository.id);
      };
    }
    announced.current = versions;
  }, [toasts, repositoryOf, openRepository]);
}

function canNotifyFromTheBackground() {
  return (
    !document.hasFocus() &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  );
}

function firstLine(text: unknown) {
  return typeof text === "string" ? text.split("\n", 1)[0] : undefined;
}

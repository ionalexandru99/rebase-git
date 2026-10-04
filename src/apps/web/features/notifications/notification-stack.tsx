import { Toast } from "@base-ui/react/toast";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { NoticeIcon } from "#web/features/notifications/components/notice-icon.tsx";

export type NoticeChoice = {
  readonly label: string;
  readonly run: () => void;
};

export type NoticeData = {
  readonly repositoryId: string | undefined;
  readonly percent?: number;
  readonly choices?: readonly [NoticeChoice, ...NoticeChoice[]];
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
  const { notice, filled } = usePacedNotice(toast);
  return (
    <Toast.Root toast={toast} swipeDirection="right" className={noticeClass}>
      <Toast.Content className="overflow-hidden px-3 py-2.5 transition-opacity duration-200 data-behind:opacity-0 data-expanded:opacity-100">
        <div className="flex items-start gap-3">
          <NoticeIcon
            type={notice.type}
            percent={filled === undefined ? notice.data?.percent : 100}
            label={String(notice.title)}
            onFilled={filled}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 text-sm">
              <Toast.Title className="min-w-0 cap-centered font-medium wrap-anywhere">
                {notice.title}
              </Toast.Title>
              {elsewhere === undefined ? null : (
                <>
                  <span
                    aria-hidden="true"
                    className="cap-centered text-muted-foreground"
                  >
                    ·
                  </span>
                  <span className="max-w-[40%] shrink-0 cap-centered truncate text-muted-foreground">
                    {elsewhere.name}
                  </span>
                </>
              )}
            </div>
            <Toast.Description className="mt-1 max-h-[min(240px,40vh)] overflow-y-auto whitespace-pre-line wrap-anywhere text-sm text-muted-foreground">
              {notice.description}
            </Toast.Description>
          </div>
          {notice.type === "loading" ? null : (
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
        {notice.actionProps?.children === undefined &&
        notice.data?.choices === undefined &&
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
            {notice.data?.choices === undefined ? (
              <Button size="xs" variant="outline" {...notice.actionProps} />
            ) : (
              <SplitChoice choices={notice.data.choices} />
            )}
          </div>
        )}
      </Toast.Content>
    </Toast.Root>
  );
}

function usePacedNotice(toast: NoticeObject) {
  const [shown, setShown] = useState(toast);
  const holding = shown !== toast && finishesRing(shown, toast);
  if (!holding && shown !== toast) setShown(toast);
  const filled = useCallback(() => setShown(toast), [toast]);
  return holding
    ? { notice: shown, filled }
    : { notice: toast, filled: undefined };
}

function finishesRing(shown: NoticeObject, next: NoticeObject) {
  return (
    shown.type === "loading" &&
    shown.data?.percent !== undefined &&
    next.data?.percent !== undefined &&
    (shown.title !== next.title || shown.type !== next.type)
  );
}

function SplitChoice({
  choices,
}: {
  readonly choices: readonly [NoticeChoice, ...NoticeChoice[]];
}) {
  const [primary] = choices;
  return (
    <div className="flex">
      <Button
        className="rounded-r-none"
        onClick={primary.run}
        size="xs"
        variant="outline"
      >
        {primary.label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More choices"
          render={
            <Button
              className="rounded-l-none border-l-0 px-1"
              size="xs"
              variant="outline"
            />
          }
        >
          <IconChevronDown aria-hidden="true" className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-auto min-w-28"
          data-base-ui-swipe-ignore
        >
          {choices.map((choice) => (
            <DropdownMenuItem key={choice.label} onClick={choice.run}>
              {choice.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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

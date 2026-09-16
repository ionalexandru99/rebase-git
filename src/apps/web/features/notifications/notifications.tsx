import { Toast } from "@base-ui/react/toast";
import { IconAlertCircle, IconX } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { Button } from "#web-ui/components/ui/button";
import { PersistentNotificationOutlet } from "#web-ui/features/notifications/components/persistent-notification";

export function NotificationsProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [outlet, setOutlet] = useState<HTMLDivElement | null>(null);
  return (
    <Toast.Provider timeout={0} limit={3}>
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
  const { toasts } = Toast.useToastManager();
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
            <Toast.Content className="flex items-center gap-3 px-3 py-2">
              <IconAlertCircle
                aria-hidden="true"
                className="size-4 shrink-0 text-status-connecting"
              />
              <Toast.Title className="min-w-0 flex-1 wrap-anywhere text-sm font-medium" />
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

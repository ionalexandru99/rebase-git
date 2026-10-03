import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

export const PersistentNotificationOutlet = createContext<HTMLElement | null>(
  null,
);

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
          className="pointer-events-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg empty:hidden"
        >
          {children}
        </div>,
        outlet,
      );
}

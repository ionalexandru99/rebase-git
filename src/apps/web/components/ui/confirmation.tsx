import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";

const listedItems = 3;

export function Confirmation({
  title,
  children,
  action,
  busy = false,
  disabled = false,
  onConfirm,
  onCancel,
  className,
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly action: string;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly className?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => {
      const active = document.activeElement;
      const lost =
        active === null ||
        active === document.body ||
        root.current?.contains(active) === true;
      if (lost && previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <section
      ref={root}
      aria-busy={busy}
      aria-label={title}
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      role="alertdialog"
    >
      <p className="min-w-0 flex-1 font-medium wrap-anywhere in-data-notification:basis-full">
        {title}
      </p>
      {children === undefined || children === null ? null : (
        <div className="basis-full text-muted-foreground">{children}</div>
      )}
      <div className="ml-auto flex gap-1.5">
        <Button ref={cancel} onClick={onCancel} size="xs" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={busy || disabled}
          onClick={onConfirm}
          size="xs"
          variant="destructive"
        >
          {action}
        </Button>
      </div>
    </section>
  );
}

export function ConfirmationList({
  items,
  total,
  className,
}: {
  readonly items: readonly string[];
  readonly total?: number;
  readonly className?: string;
}) {
  const count = total ?? items.length;
  const hidden = count - Math.min(count, listedItems);
  return (
    <>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {items.slice(0, listedItems).map((item) => (
          <li className={cn("truncate text-foreground", className)} key={item}>
            {item}
          </li>
        ))}
      </ul>
      {hidden === 0 ? null : <p className="mt-0.5">and {hidden} more</p>}
    </>
  );
}

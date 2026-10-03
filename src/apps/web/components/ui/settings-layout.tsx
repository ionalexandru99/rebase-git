import { IconChevronDown } from "@tabler/icons-react";
import { type ReactNode, type Ref, useId } from "react";
import { Button } from "#web/components/ui/button.tsx";

export function SettingsPage({
  title,
  headingRef,
  children,
}: {
  readonly title: ReactNode;
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 pt-10 pb-16 sm:px-8 sm:pt-12">
      <h1
        className="text-xl font-semibold tracking-tight outline-none"
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
      >
        {title}
      </h1>
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-2.5">
      <div className="flex min-h-7 items-center justify-between gap-4 px-3 sm:px-4">
        <h2 className="text-sm font-normal text-foreground/70">{title}</h2>
        {action}
      </div>
      <div className="rounded-xl border border-border/60 bg-card/40 [&>*+*]:border-t [&>*+*]:border-border/50">
        {children}
      </div>
    </section>
  );
}

export type SettingsStatus = "ready" | "attention";

export interface SettingsRowDetails {
  readonly label: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly content: ReactNode;
}

export function SettingsRow({
  title,
  icon,
  status,
  value,
  badge,
  description,
  descriptionId,
  liveDescription = false,
  dim = false,
  details,
  children,
}: {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly status?: SettingsStatus;
  readonly value?: string;
  readonly badge?: string;
  readonly description?: ReactNode;
  readonly descriptionId?: string;
  readonly liveDescription?: boolean;
  readonly dim?: boolean;
  readonly details?: SettingsRowDetails;
  readonly children?: ReactNode;
}) {
  const detailsId = useId();
  return (
    <div className={`space-y-4 px-3 py-3 sm:px-4 ${dim ? "opacity-80" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {icon === undefined ? null : (
              <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
                {icon}
                {status === undefined ? null : (
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute -top-0.5 -left-0.5 size-2 rounded-full ring-2 ring-repository ${status === "ready" ? "bg-status-available" : "bg-status-connecting"}`}
                  />
                )}
              </span>
            )}
            <h3 className="truncate text-sm font-medium text-foreground">
              {title}
            </h3>
            {value === undefined ? null : (
              <code className="text-xs text-muted-foreground">{value}</code>
            )}
            {badge === undefined ? null : (
              <span className="inline-flex h-4 items-center rounded-[.25rem] bg-status-connecting/15 px-1 text-[.625rem] leading-none font-medium text-status-connecting">
                {badge}
              </span>
            )}
          </div>
          {description === undefined ? null : (
            <div
              aria-atomic={liveDescription || undefined}
              aria-live={liveDescription ? "polite" : undefined}
              className="text-xs leading-normal text-muted-foreground/80"
              id={descriptionId}
            >
              {description}
            </div>
          )}
        </div>
        {children === undefined && details === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {details === undefined ? null : (
              <Button
                aria-controls={detailsId}
                aria-expanded={details.open}
                aria-label={details.label}
                className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground"
                onClick={() => details.onOpenChange(!details.open)}
                size="icon-xs"
                variant="ghost"
              >
                <IconChevronDown
                  aria-hidden="true"
                  className={`size-3.5 ${details.open ? "rotate-180" : ""}`}
                />
              </Button>
            )}
            {children}
          </div>
        )}
      </div>
      {details?.open ? <div id={detailsId}>{details.content}</div> : null}
    </div>
  );
}

export function SettingsField({
  id,
  label,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

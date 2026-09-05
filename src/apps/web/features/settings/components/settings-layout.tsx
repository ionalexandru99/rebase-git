import type { ReactNode } from "react";

export function SettingsSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 space-y-1">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  descriptionId,
  liveDescription = false,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly descriptionId?: string;
  readonly liveDescription?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-20 flex-col items-start justify-between gap-3 rounded-xl px-3 py-4 sm:px-4 md:flex-row md:items-center md:gap-8">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        {description === undefined ? null : (
          <div
            id={descriptionId}
            aria-live={liveDescription ? "polite" : undefined}
            aria-atomic={liveDescription || undefined}
            className="mt-1 text-[13px] leading-5 text-muted-foreground"
          >
            {description}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

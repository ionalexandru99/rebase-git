import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import type { DiagnosticsError } from "#contracts/diagnostics/diagnostics.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { IconSwitch } from "#web/components/ui/icon-switch.tsx";
import { SettingsSection } from "#web/components/ui/settings-layout.tsx";
import { RepositoryMark } from "#web/features/diagnostics/diagnostics-primitives.tsx";
import { ageLabel } from "#web/lib/age-label.ts";

export function Errors({
  errors,
  now,
}: {
  readonly errors: readonly DiagnosticsError[] | undefined;
  readonly now: number;
}) {
  const [order, setOrder] = useState<"latest" | "frequent">("latest");
  const [open, setOpen] = useState<string>();
  const shown =
    order === "latest"
      ? (errors ?? [])
      : (errors ?? []).toSorted((left, right) => right.count - left.count);
  return (
    <SettingsSection
      action={
        <IconSwitch
          label="Error order"
          onChange={setOrder}
          options={[
            { value: "latest", label: "Latest" },
            { value: "frequent", label: "Most frequent" },
          ]}
          value={order}
        />
      }
      title="Errors"
    >
      {errors?.length === 0 ? (
        <p className="px-4 py-3 text-meta text-muted-foreground">
          No errors since Rebase started.
        </p>
      ) : null}
      {shown.map((error) => {
        const key = errorKey(error);
        const expanded = open === key;
        return (
          <div className="space-y-3 px-4 py-3" key={key}>
            <div className="flex items-center gap-3">
              <Button
                aria-expanded={expanded}
                aria-label={`${expanded ? "Hide" : "Show"} details for ${error.title}`}
                className="text-muted-foreground"
                onClick={() => setOpen(expanded ? undefined : key)}
                size="icon-xs"
                variant="ghost"
              >
                {expanded ? (
                  <IconChevronDown aria-hidden="true" className="size-3.5" />
                ) : (
                  <IconChevronRight aria-hidden="true" className="size-3.5" />
                )}
              </Button>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-control font-medium">
                    {error.title}
                  </span>
                  {error.count > 1 ? (
                    <span className="inline-flex h-4 shrink-0 items-center rounded-control bg-destructive/15 px-1 text-badge font-medium text-destructive tabular-nums">
                      ×{error.count}
                    </span>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground/80">
                  <RepositoryMark repositoryId={error.repositoryId} small />
                  <span className="truncate">
                    {error.where} · {ageLabel(error.lastSeen / 1_000, now)}
                  </span>
                </div>
              </div>
              <span className="shrink-0 text-meta text-muted-foreground">
                {error.kind}
              </span>
            </div>
            {expanded ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-control border border-border/50 bg-background/60 px-3 py-2 font-mono text-meta leading-relaxed text-muted-foreground">
                {error.detail}
              </pre>
            ) : null}
          </div>
        );
      })}
    </SettingsSection>
  );
}

function errorKey(error: DiagnosticsError) {
  return `${error.kind}\u0000${error.title}\u0000${error.where}`;
}

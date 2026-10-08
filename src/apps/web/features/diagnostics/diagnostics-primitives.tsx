import type { DiagnosticsPeriod } from "#contracts/diagnostics/diagnostics.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { RepositoryBadge } from "#web/features/repository-catalog/repository-badge.tsx";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";

export const periodLabels: Record<DiagnosticsPeriod, string> = {
  "5m": "5 min",
  "15m": "15 min",
  "1h": "1 hour",
};

export function Choice<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly {
    readonly value: Value;
    readonly label: string;
  }[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}) {
  return (
    <div
      aria-label={label}
      className="flex gap-0.5 rounded-surface border border-sidebar-border bg-muted/30 p-0.5"
      role="radiogroup"
    >
      {options.map((option) => (
        <Button
          aria-checked={option.value === value}
          className="h-6 px-2 text-meta text-muted-foreground aria-checked:bg-sidebar-accent aria-checked:text-sidebar-accent-foreground sm:h-6"
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          size="xs"
          variant="ghost"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function RepositoryMark({
  repositoryId,
  small = false,
}: {
  readonly repositoryId: string | undefined;
  readonly small?: boolean;
}) {
  const { repositories } = useRepositoryCatalog();
  const repository = repositories.find(({ id }) => id === repositoryId);
  if (repository === undefined) return null;
  return (
    <RepositoryBadge
      className={
        small
          ? "size-4.5 shrink-0 rounded-control text-[9px]"
          : "size-6 shrink-0 rounded-control text-badge"
      }
      color={repository.color}
      name={repository.name}
    />
  );
}

export function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) {
    const seconds = milliseconds / 1_000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatPercent(value: number | null) {
  if (value === null) return "—";
  return value < 10 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

import type { DiagnosticsPeriod } from "#contracts/diagnostics/diagnostics.contract.ts";
import { RepositoryBadge } from "#web/features/repository-catalog/repository-badge.tsx";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";

export const periodLabels: Record<DiagnosticsPeriod, string> = {
  "5m": "5 min",
  "15m": "15 min",
  "1h": "1 hour",
};

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
  if (Math.round(milliseconds) < 1_000) return `${Math.round(milliseconds)} ms`;
  const tenths = Math.round(milliseconds / 100) / 10;
  if (tenths < 60)
    return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatPercent(value: number | null) {
  if (value === null) return "—";
  return value < 10 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

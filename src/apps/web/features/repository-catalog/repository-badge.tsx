import type { JSX } from "react";
import type { RepositoryColor } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { cn } from "#web/lib/utils.ts";

export const repositoryColors: Record<RepositoryColor, string> = {
  amber: "#F59E0B",
  blue: "#4C9AFF",
  cyan: "#06B6D4",
  green: "#22C55E",
  lime: "#84CC16",
  orange: "#F97316",
  red: "#EF4444",
  violet: "#B38AFF",
};

export function RepositoryBadge({
  className,
  color,
  name,
}: {
  readonly className: string;
  readonly color: RepositoryColor;
  readonly name: string;
}): JSX.Element {
  const hex = repositoryColors[color];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center font-semibold",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${hex} 22%, transparent)`,
        color: `color-mix(in oklab, ${hex} 80%, white)`,
      }}
    >
      {repositoryInitials(name)}
    </span>
  );
}

export function repositoryInitials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part[0])
    .filter((character): character is string => character !== undefined)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

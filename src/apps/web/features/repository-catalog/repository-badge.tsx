import type { JSX } from "react";
import type { RepositoryColor } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { cn } from "#web/lib/utils.ts";

export const repositoryColors: Record<RepositoryColor, string> = {
  amber: "var(--lane-7)",
  blue: "var(--lane-0)",
  cyan: "var(--lane-5)",
  green: "var(--lane-1)",
  lime: "var(--lane-4)",
  orange: "var(--lane-3)",
  red: "var(--lane-6)",
  violet: "var(--lane-2)",
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
  const tint = repositoryColors[color];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center font-semibold",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${tint} 22%, transparent)`,
        color: `color-mix(in oklab, ${tint} 80%, var(--foreground))`,
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

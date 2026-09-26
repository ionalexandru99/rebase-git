import { IconArrowDown, IconArrowLeft, IconArrowUp } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "#web/components/ui/button";

export function MergeViewBar({
  path,
  onBack,
  actions,
  children,
}: {
  readonly path: string;
  readonly onBack: () => void;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-1">
      <Button variant="ghost" size="xs" onClick={onBack}>
        <IconArrowLeft aria-hidden="true" className="size-3.5" />
        History
      </Button>
      <h1 className="min-w-0 truncate text-[.85rem] font-semibold">{path}</h1>
      {children}
      {actions}
    </div>
  );
}

export function RegionNavigation({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous region"
        aria-keyshortcuts="Alt+ArrowUp"
        disabled={!hasPrevious}
        onClick={onPrevious}
      >
        <IconArrowUp aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next region"
        aria-keyshortcuts="Alt+ArrowDown"
        disabled={!hasNext}
        onClick={onNext}
      >
        <IconArrowDown aria-hidden="true" className="size-3.5" />
      </Button>
    </>
  );
}

import type { RepositoryCommit } from "@rebase/contracts";
import { IconMinus, IconPlus } from "@tabler/icons-react";

export function CommitGraphMergeControl({
  commit,
  state,
  onToggle,
  position,
  color,
}: {
  readonly commit: RepositoryCommit;
  readonly state: "collapsed" | "expanded";
  readonly onToggle: (oid: string, expand: boolean) => void;
  readonly position: number;
  readonly color: string;
}) {
  const Icon = state === "expanded" ? IconMinus : IconPlus;
  return (
    <button
      aria-label={`${state === "expanded" ? "Collapse" : "Expand"} merge ${commit.subject}`}
      aria-expanded={state === "expanded"}
      className="absolute top-px z-[3] grid size-6 place-items-center"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(commit.oid, state !== "expanded");
      }}
      onPointerDown={(event) => event.preventDefault()}
      style={{ left: position - 12 }}
      tabIndex={-1}
      type="button"
    >
      <span
        className="grid size-[11px] place-items-center rounded-full text-repository"
        style={{ background: color }}
      >
        <Icon aria-hidden="true" size={9} stroke={2} />
      </span>
    </button>
  );
}

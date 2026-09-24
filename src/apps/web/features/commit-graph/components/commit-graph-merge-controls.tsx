import { graphRemoteOpacity } from "#web/features/commit-graph/layout/graph-colors";

export function CommitGraphMergeControl({
  subject,
  state,
  position,
  color,
  remote,
}: {
  readonly subject: string;
  readonly state: "collapsed" | "expanded";
  readonly position: number;
  readonly color: string;
  readonly remote: boolean;
}) {
  return (
    <button
      aria-label={`${state === "expanded" ? "Collapse" : "Expand"} merge ${subject}`}
      aria-expanded={state === "expanded"}
      className="absolute top-px z-[3] grid size-6 place-items-center"
      data-merge-toggle
      onPointerDown={(event) => event.preventDefault()}
      style={{ left: position - 12 }}
      tabIndex={-1}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="size-3 text-repository"
        viewBox="-6 -6 12 12"
      >
        <circle
          r="5.5"
          fill={
            remote
              ? `color-mix(in srgb, ${color} ${graphRemoteOpacity * 100}%, var(--graph-row-background, var(--repository)))`
              : color
          }
        />
        <path
          d={state === "expanded" ? "M-2.5 0h5" : "M-2.5 0h5M0-2.5v5"}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1"
        />
      </svg>
    </button>
  );
}

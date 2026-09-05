import type {
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import { CopyPill } from "#web/features/clipboard/index";
import {
  graphBranchColorIndex,
  graphLaneColor,
  graphRefName,
} from "#web/features/commit-graph/layout/graph-colors";
import { GitProviderIcon } from "#web-ui/features/commit-graph/components/git-provider-icon";
import { useGraphRefAppearance } from "#web-ui/features/commit-graph/components/graph-ref-appearance";

export function CommitRefLabels({
  labels,
}: {
  readonly labels: readonly RepositoryHistoryRefTarget[];
}) {
  const local = labels.some((label) => label.type === "branch");
  return (
    <span className="flex shrink-0 items-center gap-1">
      {labels
        .filter((label) => !(local && label.type === "remote-branch"))
        .map((label) => (
          <CommitRefPill key={`${label.type}\0${label.name}`} label={label} />
        ))}
    </span>
  );
}

export function CommitRefPill({
  label,
}: {
  readonly label: Pick<RepositoryHistoryRefTarget, "name" | "type">;
}) {
  const { colors } = useGraphRefAppearance();
  const color =
    label.type === "tag"
      ? "#D3BE8B"
      : (colors.get(label.name) ??
        graphLaneColor(
          graphBranchColorIndex(graphRefName({ ...label, oid: "" })),
        ));
  const local = label.type === "branch";
  const remote =
    label.type === "remote-branch"
      ? label.name.slice(0, label.name.indexOf("/"))
      : undefined;
  return (
    <CopyPill
      value={label.name}
      className="rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] leading-none outline-none focus-visible:ring-1 focus-visible:ring-primary"
      style={{
        color: local ? "#0e141c" : color,
        borderColor: local
          ? color
          : `color-mix(in srgb, ${color} 24%, var(--repository))`,
        background: local
          ? color
          : `color-mix(in srgb, ${color} 17%, var(--repository))`,
      }}
    >
      {remote === undefined ? null : <GitProviderIcon remote={remote} />}
      {remote === undefined ? label.name : label.name.slice(remote.length + 1)}
    </CopyPill>
  );
}

export function historyLabelTarget(
  label: RepositoryHistoryRefTarget,
): RepositoryRefTarget | undefined {
  if (label.type === "branch") return { _tag: "LocalBranch", name: label.name };
  if (label.type === "tag") return { _tag: "Tag", name: label.name };
  if (label.type === "remote-branch") {
    const separator = label.name.indexOf("/");
    if (separator > 0)
      return {
        _tag: "RemoteBranch",
        remote: label.name.slice(0, separator),
        name: label.name.slice(separator + 1),
      };
  }
  return undefined;
}

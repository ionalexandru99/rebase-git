import type {
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import { IconX } from "@tabler/icons-react";
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
  onRemove,
}: {
  readonly label: Pick<RepositoryHistoryRefTarget, "name" | "type">;
  readonly onRemove?: (() => void) | undefined;
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
  const separator =
    label.type === "remote-branch" ? label.name.indexOf("/") : -1;
  const remote = separator > 0 ? label.name.slice(0, separator) : undefined;
  const name =
    remote === undefined ? label.name : label.name.slice(separator + 1);
  return (
    <span
      className="group/ref inline-flex shrink-0 items-center rounded-[5px] border font-mono text-[10px] leading-none"
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
      <CopyPill
        value={name}
        className="rounded-[4px] px-1.5 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {remote === undefined ? null : <GitProviderIcon remote={remote} />}
        {name}
      </CopyPill>
      {onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={`Remove ${label.name} from history`}
          className="pointer-events-none mr-0.5 grid size-3.5 shrink-0 place-items-center rounded-[3px] opacity-0 outline-none hover:bg-black/10 focus-visible:ring-1 focus-visible:ring-primary group-focus-within/ref:pointer-events-auto group-focus-within/ref:opacity-100 group-hover/ref:pointer-events-auto group-hover/ref:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
          onClick={onRemove}
        >
          <IconX aria-hidden="true" className="size-3" />
        </button>
      )}
    </span>
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

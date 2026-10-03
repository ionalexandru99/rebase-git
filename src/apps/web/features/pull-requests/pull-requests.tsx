import {
  IconCheck,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconPointFilled,
  IconX,
} from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type PullRequest,
  PullRequestsApi,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import type { RepositoryRefTarget } from "#contracts/repository-refs/repository-refs.contract.ts";
import { submenu } from "#web/components/ui/action-menu.tsx";
import { ToolbarButton } from "#web/components/ui/toolbar-button.tsx";
import type { RefAction } from "#web/features/refs/ref-actions.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export interface PullRequests {
  readonly forBranch: (branch: string) => readonly PullRequest[];
  readonly actionFor: (target: RepositoryRefTarget) => RefAction | undefined;
}

const none: readonly PullRequest[] = [];

export function usePullRequests(): PullRequests {
  const repositoryId = useRepositoryScope()?.repositoryId;
  const { data } = useEnvironmentQuery(
    PullRequestsApi.list,
    repositoryId === undefined ? skipToken : { repositoryId },
    { changes: "refs", refetchOnWindowFocus: "always" },
  );
  return useMemo(() => {
    const byBranch = new Map(
      data?.map(({ branch, pullRequests }) => [branch, pullRequests]),
    );
    const forBranch = (branch: string) => byBranch.get(branch) ?? none;
    return {
      forBranch,
      actionFor: (target) =>
        target._tag === "LocalBranch"
          ? pullRequestAction(forBranch(target.name))
          : undefined,
    };
  }, [data]);
}

export function CurrentPullRequest({
  pullRequests,
}: {
  readonly pullRequests: PullRequests;
}) {
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const branch =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath)?.branch;
  const [pullRequest] =
    branch === undefined ? none : pullRequests.forBranch(branch);
  if (pullRequest === undefined) return null;
  return (
    <ToolbarButton
      aria-label={`Open ${describePullRequest(pullRequest)}${checksLabel(pullRequest)}`}
      onClick={() => openPullRequest(pullRequest)}
    >
      <PullRequestStateIcon pullRequest={pullRequest} />
      <span className="tabular-nums">{reference(pullRequest)}</span>
      <PullRequestChecksIcon pullRequest={pullRequest} />
    </ToolbarButton>
  );
}

function PullRequestStateIcon({
  pullRequest,
}: {
  readonly pullRequest: PullRequest;
}) {
  const { Icon, className } = stateIcons[pullRequest.state];
  return (
    <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${className}`} />
  );
}

export function PullRequestLink({
  pullRequests,
}: {
  readonly pullRequests: readonly PullRequest[];
}) {
  const [newest] = pullRequests;
  if (newest === undefined) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 pr-1.5 text-[.78rem] tabular-nums">
      <button
        aria-label={`Open ${describePullRequest(newest)}`}
        className={`inline-flex items-center gap-1 rounded-sm underline-offset-2 outline-none hover:underline ${stateIcons[newest.state].className}`}
        onClick={() => openPullRequest(newest)}
        tabIndex={-1}
        type="button"
      >
        <PullRequestStateIcon pullRequest={newest} />
        {newest.number}
      </button>
      {pullRequests.length > 1 ? (
        <span aria-hidden="true" className="text-muted-foreground">
          +{pullRequests.length - 1}
        </span>
      ) : null}
    </span>
  );
}

export function describePullRequest(pullRequest: PullRequest) {
  return `${terms[pullRequest.kind].name} ${reference(pullRequest)}, ${pullRequest.state.toLowerCase()}`;
}

function PullRequestChecksIcon({
  pullRequest,
}: {
  readonly pullRequest: PullRequest;
}) {
  const checks = visibleChecks(pullRequest);
  if (checks === undefined) return null;
  const { Icon, className } = checksIcons[checks];
  return <Icon aria-hidden="true" className={`size-3 shrink-0 ${className}`} />;
}

function checksLabel(pullRequest: PullRequest) {
  const checks = visibleChecks(pullRequest);
  return checks === undefined ? "" : `, checks ${checks.toLowerCase()}`;
}

function visibleChecks(pullRequest: PullRequest) {
  return pullRequest.state === "Open" || pullRequest.state === "Draft"
    ? pullRequest.checks
    : undefined;
}

function pullRequestAction(
  pullRequests: readonly PullRequest[],
): RefAction | undefined {
  const [only] = pullRequests;
  if (only === undefined) return undefined;
  if (pullRequests.length === 1)
    return {
      id: "openPullRequest",
      label: `Open ${terms[only.kind].name}`,
      enabled: true,
      run: () => openPullRequest(only),
    };
  return submenu(
    { id: "pullRequests", label: terms[only.kind].plural },
    pullRequests.map((pullRequest) => ({
      id: `openPullRequest:${pullRequest.number}`,
      label: pullRequest.title,
      detail: reference(pullRequest),
      icon: <PullRequestStateIcon pullRequest={pullRequest} />,
      enabled: true,
      run: () => openPullRequest(pullRequest),
    })),
  );
}

function reference(pullRequest: PullRequest) {
  return `${terms[pullRequest.kind].sigil}${pullRequest.number}`;
}

function openPullRequest(pullRequest: PullRequest) {
  window.open(pullRequest.url, "_blank", "noopener,noreferrer");
}

const terms = {
  PullRequest: { name: "pull request", plural: "Pull requests", sigil: "#" },
  MergeRequest: { name: "merge request", plural: "Merge requests", sigil: "!" },
} as const;

const stateIcons = {
  Open: { Icon: IconGitPullRequest, className: "text-status-available" },
  Draft: { Icon: IconGitPullRequestDraft, className: "text-muted-foreground" },
  Merged: { Icon: IconGitMerge, className: "text-violet-400" },
  Closed: {
    Icon: IconGitPullRequestClosed,
    className: "text-status-unavailable",
  },
} as const;

const checksIcons = {
  Passing: { Icon: IconCheck, className: "text-status-available" },
  Failing: { Icon: IconX, className: "text-status-unavailable" },
  Pending: { Icon: IconPointFilled, className: "text-status-connecting" },
} as const;

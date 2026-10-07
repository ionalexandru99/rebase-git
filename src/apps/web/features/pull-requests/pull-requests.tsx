import {
  IconCheck,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconPointFilled,
  IconUnlink,
  IconX,
} from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import {
  type PullRequest,
  type PullRequestKind,
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
  readonly kind: PullRequestKind;
  readonly forBranch: (branch: string) => readonly PullRequest[];
  readonly actionsFor: (
    target: RepositoryRefTarget,
    link?: () => void,
  ) => readonly RefAction[];
}

const none: readonly PullRequest[] = [];

export function usePullRequests(): PullRequests {
  const repositoryId = useRepositoryScope()?.repositoryId;
  const { data } = useEnvironmentQuery(
    PullRequestsApi.list,
    repositoryId === undefined ? skipToken : { repositoryId },
    { changes: "refs", refetchOnWindowFocus: "always" },
  );
  const byBranch = new Map(
    data?.branches.map(({ branch, pullRequests }) => [branch, pullRequests]),
  );
  const forBranch = (branch: string) => byBranch.get(branch) ?? none;
  const kind = data?.kind ?? "PullRequest";
  return {
    kind,
    forBranch,
    actionsFor: (target, link) => {
      if (target._tag !== "LocalBranch") return [];
      const open = pullRequestAction(forBranch(target.name));
      return [
        ...(open === undefined ? [] : [open]),
        ...(link === undefined || data == null
          ? []
          : [
              {
                id: "linkPullRequest" as const,
                label: `Link ${pullRequestTerms[kind].name}…`,
                enabled: true,
                takesFocus: true,
                run: link,
              },
            ]),
      ];
    },
  };
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
      <span className="tabular-nums">{pullRequestReference(pullRequest)}</span>
      <PullRequestChecksIcon pullRequest={pullRequest} />
    </ToolbarButton>
  );
}

export function PullRequestStateIcon({
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
    <span className="flex shrink-0 items-center gap-1 pr-1.5 text-meta tabular-nums">
      <button
        aria-label={`Open ${describePullRequest(newest)}`}
        className={`inline-flex items-center gap-1 rounded-control underline-offset-2 outline-none hover:underline ${stateIcons[newest.state].className}`}
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

export function PullRequestList({
  focusable,
  onUnlink,
  pullRequests,
}: {
  readonly focusable: boolean;
  readonly onUnlink: (pullRequest: PullRequest) => void;
  readonly pullRequests: readonly PullRequest[];
}) {
  return pullRequests.map((pullRequest) => (
    <div
      className="group/pr flex h-6 min-w-0 items-center gap-2.5 text-body"
      key={pullRequest.number}
    >
      <PullRequestStateIcon pullRequest={pullRequest} />
      <button
        aria-label={`Open ${describePullRequest(pullRequest)}`}
        className="shrink-0 rounded-control text-muted-foreground tabular-nums underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
        onClick={() => openPullRequest(pullRequest)}
        tabIndex={focusable ? 0 : -1}
        type="button"
      >
        {pullRequestReference(pullRequest)}
      </button>
      <span className="min-w-0 flex-1 truncate text-foreground/85">
        {pullRequest.title}
      </span>
      <button
        aria-label={`Unlink ${pullRequestTerms[pullRequest.kind].name} ${pullRequestReference(pullRequest)}`}
        className="grid size-5 shrink-0 place-items-center rounded-control text-muted-foreground opacity-0 outline-none group-hover/pr:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => onUnlink(pullRequest)}
        tabIndex={focusable ? 0 : -1}
        type="button"
      >
        <IconUnlink aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  ));
}

export function describePullRequest(pullRequest: PullRequest) {
  return `${pullRequestTerms[pullRequest.kind].name} ${pullRequestReference(pullRequest)}, ${pullRequest.state.toLowerCase()}`;
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
      label: `Open ${pullRequestTerms[only.kind].name}`,
      enabled: true,
      run: () => openPullRequest(only),
    };
  return submenu(
    { id: "pullRequests", label: pullRequestTerms[only.kind].plural },
    pullRequests.map((pullRequest) => ({
      id: `openPullRequest:${pullRequest.number}`,
      label: pullRequest.title,
      detail: pullRequestReference(pullRequest),
      icon: <PullRequestStateIcon pullRequest={pullRequest} />,
      enabled: true,
      run: () => openPullRequest(pullRequest),
    })),
  );
}

export function pullRequestReference(pullRequest: PullRequest) {
  return `${pullRequestTerms[pullRequest.kind].sigil}${pullRequest.number}`;
}

function openPullRequest(pullRequest: PullRequest) {
  window.open(pullRequest.url, "_blank", "noopener,noreferrer");
}

export const pullRequestTerms = {
  PullRequest: {
    name: "pull request",
    title: "Pull request",
    plural: "Pull requests",
    sigil: "#",
  },
  MergeRequest: {
    name: "merge request",
    title: "Merge request",
    plural: "Merge requests",
    sigil: "!",
  },
} as const;

const stateIcons = {
  Open: { Icon: IconGitPullRequest, className: "text-status-available" },
  Draft: { Icon: IconGitPullRequestDraft, className: "text-muted-foreground" },
  Merged: {
    Icon: IconGitMerge,
    className: "text-violet-600 dark:text-violet-400",
  },
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

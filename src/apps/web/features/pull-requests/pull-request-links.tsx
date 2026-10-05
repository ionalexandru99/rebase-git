import { IconLink } from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import {
  type BranchPullRequests,
  isSamePullRequestLink,
  type LinkPullRequest,
  type PullRequest,
  PullRequestsApi,
  pullRequestNumber,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { Input } from "#web/components/ui/input.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import {
  PullRequestStateIcon,
  pullRequestReference,
  pullRequestTerms,
} from "#web/features/pull-requests/pull-requests.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export type SetPullRequestLinked = (
  branch: string,
  pullRequest: PullRequest,
  linked: boolean,
) => void;

export function usePullRequestLinking(): SetPullRequestLinked {
  const errorToast = useErrorToast();
  const changing = useRef(new Map<number, PullRequest>());
  const command = useCommand(PullRequestsApi.link, {
    answers: (_, input) => [
      answer(
        PullRequestsApi.list,
        { repositoryId: input.repositoryId },
        (current) =>
          relinked(current ?? [], input, changing.current.get(input.number)),
      ),
    ],
  });
  return (branch, pullRequest, linked) => {
    changing.current.set(pullRequest.number, pullRequest);
    void command
      .run({ branch, number: pullRequest.number, linked })
      .then((result) => {
        changing.current.delete(pullRequest.number);
        errorToast.failure(
          linked ? "linkPullRequest" : "unlinkPullRequest",
          result,
        );
      });
  };
}

export function LinkPullRequestField({
  branch,
  onLinked,
  setLinked,
}: {
  readonly branch: string;
  readonly onLinked: () => void;
  readonly setLinked: SetPullRequestLinked;
}) {
  const repositoryId = useRepositoryScope()?.repositoryId;
  const [reference, setReference] = useState("");
  const problemId = useId();
  const number = pullRequestNumber(reference);
  const { data, isError } = useEnvironmentQuery(
    PullRequestsApi.find,
    repositoryId === undefined || number === undefined
      ? skipToken
      : { repositoryId, number },
    { changes: "none" },
  );
  const found =
    data?.pullRequest != null &&
    isSamePullRequestLink(data.pullRequest.url, reference)
      ? data.pullRequest
      : undefined;
  const problem =
    number === undefined
      ? undefined
      : data !== undefined && found === undefined
        ? `No ${pullRequestTerms[data.kind].name} ${pullRequestTerms[data.kind].sigil}${number}`
        : isError
          ? "Couldn't look it up"
          : undefined;
  return (
    <>
      <div className="flex items-center gap-2.5">
        <IconLink
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <Input
          aria-describedby={problem === undefined ? undefined : problemId}
          aria-invalid={problem === undefined ? undefined : true}
          aria-label="Pull request number or link"
          autoFocus
          className="h-7 sm:h-6.5"
          onChange={(event) => setReference(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || found === undefined) return;
            event.preventDefault();
            setLinked(branch, found, true);
            onLinked();
          }}
          placeholder="Number or link"
          value={reference}
        />
      </div>
      {found === undefined ? null : (
        <div className="mt-1.5 flex h-6 min-w-0 items-center gap-2.5 pl-6 text-[.85rem]">
          <PullRequestStateIcon pullRequest={found} />
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {pullRequestReference(found)}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground/85">
            {found.title}
          </span>
          <kbd className="shrink-0 font-sans text-[.7rem] text-muted-foreground">
            Enter
          </kbd>
        </div>
      )}
      {problem === undefined ? null : (
        <p
          className="mt-1.5 pl-6 text-[.85rem] text-destructive"
          id={problemId}
        >
          {problem}
        </p>
      )}
    </>
  );
}

function relinked(
  list: readonly BranchPullRequests[],
  { branch, linked, number }: LinkPullRequest,
  pullRequest: PullRequest | undefined,
): readonly BranchPullRequests[] {
  const kept = (
    list.find((entry) => entry.branch === branch)?.pullRequests ?? []
  ).filter((candidate) => candidate.number !== number);
  const pullRequests =
    linked && pullRequest !== undefined ? [pullRequest, ...kept] : kept;
  const others = list.filter((entry) => entry.branch !== branch);
  return pullRequests.length === 0
    ? others
    : [...others, { branch, pullRequests }];
}

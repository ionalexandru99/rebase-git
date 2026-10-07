import { skipToken } from "@tanstack/react-query";
import type { RepositoryTag } from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function TagDetails({
  tag,
  level,
}: {
  readonly tag: RepositoryTag;
  readonly level: number;
}) {
  const scope = useRepositoryScope();
  const annotation = useEnvironmentQuery(
    RepositoryTagsApi.annotation,
    tag.object === undefined || scope === undefined
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          name: tag.name,
        },
    { changes: "refs" },
  );
  const details = annotation.data;
  const date = new Date(details?.tagger.date ?? "");
  return (
    <section
      aria-label={`${tag.name} details`}
      className="mr-1.5 mb-1.5 border-sidebar-border border-l py-1 pl-2.5 text-meta leading-snug text-muted-foreground"
      style={{ marginLeft: 16 + (level - 2) * 18 }}
    >
      {tag.object === undefined ? (
        <p>
          Lightweight · commit{" "}
          <span className="font-mono">{tag.target?.slice(0, 7)}</span>
        </p>
      ) : (
        <>
          {details === undefined ? null : (
            <>
              <p className="mb-1 line-clamp-4 whitespace-pre-wrap break-words text-sidebar-foreground">
                {details.message}
              </p>
              <p className="break-words">
                {[
                  details.tagger.name,
                  Number.isNaN(date.getTime())
                    ? details.tagger.date
                    : dateFormat.format(date),
                  ...(details.signed ? ["signed"] : []),
                ].join(" · ")}
              </p>
            </>
          )}
          {annotation.isError ? (
            <p className="text-status-unavailable">
              {describeFailure(annotation.error)}
            </p>
          ) : null}
          <p className="font-mono text-meta">
            tag {tag.object.slice(0, 7)} → commit {tag.target?.slice(0, 7)}
          </p>
        </>
      )}
    </section>
  );
}

import { skipToken } from "@tanstack/react-query";
import { useState } from "react";
import { AuthorAvatarsApi } from "#contracts/author-avatars/author-avatars.contract.ts";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export function AuthorAvatar({
  author,
}: {
  readonly author: Pick<RepositoryCommit["author"], "name" | "email">;
}) {
  const repositoryId = useRepositoryScope()?.repositoryId;
  const email = author.email.trim().toLowerCase();
  const { data: image } = useEnvironmentQuery(
    AuthorAvatarsApi.read,
    repositoryId === undefined || email === ""
      ? skipToken
      : { repositoryId, email },
    { changes: "none", persist: true },
  );
  const [failed, setFailed] = useState<string>();
  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-accent text-badge font-semibold text-foreground"
    >
      {image === undefined || image === null || image === failed ? (
        initialsOf(author.name)
      ) : (
        <img
          alt=""
          src={image}
          width={20}
          height={20}
          decoding="async"
          onError={() => setFailed(image)}
        />
      )}
    </span>
  );
}

function initialsOf(name: string) {
  const names = name.trim().split(/\s+/).filter(Boolean);
  const initials = [
    names[0]?.[0],
    names.length > 1 ? names.at(-1)?.[0] : undefined,
  ].join("");
  return initials.toUpperCase() || "?";
}

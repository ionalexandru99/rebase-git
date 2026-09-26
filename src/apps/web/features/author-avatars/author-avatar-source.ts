import type { RepositoryRefs } from "@rebase/contracts";

export type GitHubRepository = NonNullable<RepositoryRefs["githubRepository"]>;
export interface AvatarAuthor {
  readonly oid: string;
  readonly author: { readonly email: string };
}

export class AvatarUnavailable extends Error {
  readonly _tag = "AvatarUnavailable";
  readonly retryAt: number | undefined;

  constructor(retryAt?: number) {
    super("The avatar is unavailable.");
    this.retryAt = retryAt;
  }
}

export interface AuthorAvatarSource {
  readonly resolve: (
    repository: GitHubRepository,
    author: AvatarAuthor,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
}

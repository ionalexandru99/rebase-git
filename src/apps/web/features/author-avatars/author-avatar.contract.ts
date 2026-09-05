import type { RepositoryRefs } from "@rebase/contracts";
import { Context, Data, type Effect } from "effect";

export type GitHubRepository = NonNullable<RepositoryRefs["githubRepository"]>;
export interface AvatarAuthor {
  readonly oid: string;
  readonly author: { readonly email: string };
}

export class AvatarUnavailable extends Data.TaggedError("AvatarUnavailable")<{
  readonly retryAt?: number;
}> {}

export class AuthorAvatarSource extends Context.Service<
  AuthorAvatarSource,
  {
    readonly resolve: (
      repository: GitHubRepository,
      author: AvatarAuthor,
    ) => Effect.Effect<string | undefined, AvatarUnavailable>;
  }
>()("rebase/AuthorAvatarSource") {}

export interface AuthorAvatarModel {
  readonly get: (email: string) => string | undefined;
  readonly subscribe: (
    author: AvatarAuthor,
    listener: () => void,
  ) => () => void;
  readonly dispose: () => Promise<void>;
}

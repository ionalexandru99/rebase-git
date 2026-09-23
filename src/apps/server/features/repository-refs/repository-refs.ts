import { Effect, Layer } from "effect";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import {
  RepositoryAccess,
  type RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import {
  RepositoryCoordination,
  type RepositoryCoordinationService,
} from "#server/domain/repository-coordination.contract";
import {
  type RepositoryChangePublisher,
  RepositoryChangePublishing,
  RepositoryRefsAccess,
  type RepositoryRefsService,
} from "#server/domain/repository-refs.contract";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs";
import {
  repositoryAccessFailed,
  repositoryRefsFailure,
} from "#server/features/repository-refs/git/repository-refs-failures";

export function createRepositoryRefsService(dependencies: {
  readonly access: RepositoryAccessService;
  readonly changes: RepositoryChangePublisher;
  readonly git: GitCommandRunner;
  readonly coordination: RepositoryCoordinationService;
}): RepositoryRefsService {
  const { access, changes, git, coordination } = dependencies;
  return {
    checkout: (command) =>
      Effect.gen(function* () {
        yield* access
          .worktree(command)
          .pipe(Effect.mapError(repositoryAccessFailed));
        return yield* coordination
          .run(
            command.worktreePath,
            "worktree-and-refs",
            checkoutRepositoryRef(git, access, command),
          )
          .pipe(
            Effect.mapError((error) =>
              error._tag === "RepositoryCoordinationError"
                ? repositoryRefsFailure({
                    _tag: "GitFailed",
                    reason: "Failed",
                    detail: error.detail,
                  })
                : error,
            ),
          );
      }),
    read: (repositoryId) =>
      Effect.gen(function* () {
        const repository = yield* access
          .repository(repositoryId)
          .pipe(Effect.mapError(repositoryAccessFailed));
        yield* changes.watch(repository);
        return yield* readRepositoryRefs(git, repository);
      }),
  };
}

export const repositoryRefsLayer = Layer.effect(
  RepositoryRefsAccess,
  Effect.gen(function* () {
    return createRepositoryRefsService({
      access: yield* RepositoryAccess,
      changes: yield* RepositoryChangePublishing,
      git: yield* GitCommands,
      coordination: yield* RepositoryCoordination,
    });
  }),
);

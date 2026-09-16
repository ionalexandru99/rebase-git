import { Effect, Semaphore } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type {
  RepositoryWriteIntent,
  RepositoryWriteInvalidation,
  RepositoryWritesService,
} from "#server/domain/repository-writes.contract";
import { operationError } from "#server/features/repository-operations/git/operation-errors";
import { resolveOperationDirectories } from "#server/features/repository-operations/git/operation-metadata";
import { readRepositoryOperation } from "#server/features/repository-operations/git/read-operation";

export function createRepositoryWrites(
  git: GitCommandRunner,
  invalidate: (event: RepositoryWriteInvalidation) => void = () => {},
): RepositoryWritesService {
  const locks = new Map<
    string,
    { semaphore: Semaphore.Semaphore; owners: number }
  >();
  const withLock = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        let entry = locks.get(key);
        if (entry === undefined) {
          entry = { semaphore: Semaphore.makeUnsafe(1), owners: 0 };
          locks.set(key, entry);
        }
        entry.owners++;
        return entry;
      }),
      (entry) => entry.semaphore.withPermit(effect),
      (entry) =>
        Effect.sync(() => {
          if (--entry.owners === 0) locks.delete(key);
        }),
    );
  return {
    run: (directory, intent, operation) =>
      Effect.gen(function* () {
        const paths = yield* resolveOperationDirectories(git, directory);
        const sharedRefs = [
          "fetch",
          "checkout",
          "commit",
          "amend",
          "recover",
        ].includes(intent);
        const affected = {
          status: intent !== "fetch",
          refs: sharedRefs,
          history: sharedRefs,
        };
        const execute = validateWrite(git, directory, intent).pipe(
          Effect.andThen(
            operation.pipe(
              Effect.ensuring(
                Effect.sync(() => invalidate({ directory, affected })),
              ),
            ),
          ),
        );
        const worktree =
          intent === "fetch"
            ? execute
            : withLock(`worktree:${paths.gitDirectory}`, execute);
        return yield* sharedRefs
          ? withLock(`refs:${paths.commonDirectory}`, worktree)
          : worktree;
      }),
  };
}

function validateWrite(
  git: GitCommandRunner,
  directory: string,
  intent: RepositoryWriteIntent,
) {
  if (intent === "fetch" || intent === "recover") return Effect.void;
  return readRepositoryOperation(git, directory).pipe(
    Effect.flatMap((state) => {
      if (state.lock !== null)
        return Effect.fail(
          operationError("Locked", `Git lock exists: ${state.lock}.`),
        );
      if (state.kind === "idle") return Effect.void;
      if (
        state.kind !== "unknown" &&
        (intent === "stage" || intent === "unstage")
      )
        return Effect.void;
      if (
        intent === "amend" &&
        state.kind === "rebase" &&
        state.phase === "edit"
      )
        return Effect.void;
      return Effect.fail(
        operationError(
          "Incompatible",
          `Cannot ${intent} while ${state.kind === "unknown" ? "an unrecognized Git operation is" : `${state.kind} is`} in progress.`,
        ),
      );
    }),
  );
}

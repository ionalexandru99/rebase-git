import { Cause, Context, Effect, Exit, Option, Stream } from "effect";
import type { EnvironmentFeatures } from "#server/adapters/environment-transport/environment-routes.ts";
import type {
  GitCommandRunner,
  GitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import type {
  DiagnosticsActivity,
  GitRunOutcome,
} from "#server/features/diagnostics/diagnostics-activity.ts";

interface Request {
  readonly procedure?: string;
  readonly repositoryId?: string;
}

const CurrentRequest = Context.Reference<Request>("rebase/CurrentRequest", {
  defaultValue: () => ({}),
});

export function recordGitActivity(
  git: GitCommandRunner,
  activity: DiagnosticsActivity,
): GitCommandRunner {
  return {
    run: (command) =>
      Effect.gen(function* () {
        const { repositoryId } = yield* CurrentRequest;
        const run = activity.gitStarted({ ...command, repositoryId });
        return yield* git.run({ ...command, onSpawn: run.spawned }).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() =>
              run.finished(
                Exit.isSuccess(exit)
                  ? {
                      _tag: "Exited",
                      exitCode: exit.value.exitCode,
                      stderr: exit.value.stderr,
                    }
                  : failedOutcome(exit.cause),
              ),
            ),
          ),
        );
      }),
    stream: (command) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const { repositoryId } = yield* CurrentRequest;
          const run = activity.gitStarted({
            ...command,
            repositoryId,
            expectedExitCodes: [0],
          });
          return git
            .stream({ ...command, onSpawn: run.spawned })
            .pipe(
              Stream.onExit((exit) =>
                Effect.sync(() =>
                  run.finished(
                    Exit.isSuccess(exit)
                      ? { _tag: "Exited", exitCode: 0, stderr: "" }
                      : failedOutcome(exit.cause),
                  ),
                ),
              ),
            );
        }),
      ),
  };
}

export function observeFeatures(
  features: EnvironmentFeatures,
  activity: DiagnosticsActivity,
): EnvironmentFeatures {
  return {
    routes: features.routes.map(({ route, handle }) => ({
      route,
      handle: (input, context) =>
        Effect.suspend(() => {
          const request = requestOf(route._tag, input);
          const startedAt = performance.now();
          return handle(input, context).pipe(
            reportingDefects(activity, request),
            Effect.ensuring(
              Effect.sync(() =>
                activity.requestFinished(
                  route._tag,
                  request.repositoryId,
                  performance.now() - startedAt,
                ),
              ),
            ),
            Effect.provideService(CurrentRequest, request),
          );
        }),
    })),
    rpc: () =>
      Object.fromEntries(
        Object.entries(features.rpc()).map(([procedure, handler]) => [
          procedure,
          (payload: unknown, options: unknown) => {
            const request = requestOf(procedure, payload);
            const result = (
              handler as (payload: unknown, options: unknown) => unknown
            )(payload, options);
            return Stream.isStream(result)
              ? result.pipe(
                  Stream.tapCause((cause) =>
                    Effect.sync(() => reportDefect(activity, request, cause)),
                  ),
                  Stream.provideService(CurrentRequest, request),
                )
              : (result as Effect.Effect<unknown, unknown>).pipe(
                  reportingDefects(activity, request),
                  Effect.provideService(CurrentRequest, request),
                );
          },
        ]),
      ),
  };
}

function reportingDefects(activity: DiagnosticsActivity, request: Request) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapCause((cause) =>
        Effect.sync(() => reportDefect(activity, request, cause)),
      ),
    );
}

export function reportDefect(
  activity: DiagnosticsActivity,
  request: Request,
  cause: Cause.Cause<unknown>,
) {
  if (!Cause.hasDies(cause)) return;
  const detail = Cause.pretty(cause);
  activity.reportError({
    kind: "Server",
    title: detail.split("\n")[0]?.trim() || "Unexpected server error",
    where: request.procedure ?? "Server",
    detail,
    ...(request.repositoryId === undefined
      ? {}
      : { repositoryId: request.repositoryId }),
  });
}

function requestOf(procedure: string, input: unknown): Request {
  const repositoryId =
    typeof input === "object" &&
    input !== null &&
    "repositoryId" in input &&
    typeof input.repositoryId === "string"
      ? input.repositoryId
      : undefined;
  return repositoryId === undefined
    ? { procedure }
    : { procedure, repositoryId };
}

function failedOutcome(cause: Cause.Cause<GitFailed>): GitRunOutcome {
  if (Cause.hasInterruptsOnly(cause)) return { _tag: "Interrupted" };
  const failure = Cause.findErrorOption(cause);
  if (Option.isNone(failure))
    return { _tag: "Failed", reason: "Defect", detail: Cause.pretty(cause) };
  return failure.value.exitCode === undefined
    ? {
        _tag: "Failed",
        reason: failure.value.reason,
        detail: failure.value.detail,
      }
    : {
        _tag: "Exited",
        exitCode: failure.value.exitCode,
        stderr: failure.value.detail,
      };
}

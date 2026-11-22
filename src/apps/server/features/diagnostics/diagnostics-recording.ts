import {
  currentRequest,
  type EnvironmentFeature,
  type RouteHandler,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  isGitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import type {
  DiagnosticsActivity,
  GitRunOutcome,
} from "#server/features/diagnostics/diagnostics-activity.ts";

type StreamHandler = Extract<RouteHandler, { route: { stream: true } }>;
type RequestHandler = Exclude<RouteHandler, StreamHandler>;

interface Request {
  readonly procedure?: string;
  readonly repositoryId?: string;
}

export function recordGitActivity(
  git: GitCommandRunner,
  activity: DiagnosticsActivity,
): GitCommandRunner {
  return {
    run: async (command) => {
      const request = currentRequest();
      const signal = command.signal ?? request?.signal;
      const run = activity.gitStarted({
        ...command,
        repositoryId: request?.repositoryId,
      });
      try {
        const output = await git.run({ ...command, onSpawn: run.spawned });
        run.finished({
          _tag: "Exited",
          exitCode: output.exitCode,
          stderr: output.stderr,
        });
        return output;
      } catch (error) {
        run.finished(failedOutcome(error, signal));
        throw error;
      }
    },
    stream: (command) => ({
      async *[Symbol.asyncIterator]() {
        const request = currentRequest();
        const signal = command.signal ?? request?.signal;
        const run = activity.gitStarted({
          ...command,
          repositoryId: request?.repositoryId,
          expectedExitCodes: [0],
        });
        let outcome: GitRunOutcome = {
          _tag: "Exited",
          exitCode: 0,
          stderr: "",
        };
        try {
          yield* git.stream({ ...command, onSpawn: run.spawned });
        } catch (error) {
          outcome = failedOutcome(error, signal);
          throw error;
        } finally {
          run.finished(outcome);
        }
      },
    }),
  };
}

export function observeFeatures(
  features: EnvironmentFeature,
  activity: DiagnosticsActivity,
): EnvironmentFeature {
  return {
    routes: features.routes.map((handler): RouteHandler => {
      if (handler.route.stream) {
        const handle = (handler as StreamHandler).handle;
        return {
          route: handler.route,
          handle: (input, context) => ({
            async *[Symbol.asyncIterator]() {
              try {
                yield* handle(input, context);
              } catch (error) {
                if (!context.signal.aborted)
                  reportDefect(
                    activity,
                    requestOf(handler.route._tag, input),
                    error,
                  );
                throw error;
              }
            },
          }),
        };
      }
      const handle = (handler as RequestHandler).handle;
      return {
        route: handler.route,
        handle: async (input, context) => {
          const request = requestOf(handler.route._tag, input);
          const startedAt = performance.now();
          try {
            return await handle(input, context);
          } catch (error) {
            if (!context.signal.aborted) reportDefect(activity, request, error);
            throw error;
          } finally {
            activity.requestFinished(
              handler.route._tag,
              request.repositoryId,
              performance.now() - startedAt,
            );
          }
        },
      };
    }),
  };
}

export function reportDefect(
  activity: DiagnosticsActivity,
  request: Request,
  error: unknown,
) {
  if (!(error instanceof Error) || error.name === "AbortError") return;
  const detail = error.stack ?? `${error.name}: ${error.message}`;
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

function failedOutcome(
  error: unknown,
  signal: AbortSignal | undefined,
): GitRunOutcome {
  if (signal?.aborted) return { _tag: "Interrupted" };
  if (!isGitFailed(error))
    return {
      _tag: "Failed",
      reason: "Defect",
      detail:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  return error.exitCode === undefined
    ? { _tag: "Failed", reason: error.reason, detail: error.detail }
    : { _tag: "Exited", exitCode: error.exitCode, stderr: error.detail };
}

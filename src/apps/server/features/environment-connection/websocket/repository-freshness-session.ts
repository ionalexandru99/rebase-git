import type {
  EnvironmentAccessCapability,
  RepositoryFreshnessClientMessage,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { RepositoryFreshnessService } from "#server/domain/repository-freshness.contract";
import type { EnvironmentWebSocketWriter } from "#server/features/environment-connection/websocket/environment-websocket-writer";

interface Subscription {
  release?: () => void;
}

export function acquireRepositoryFreshnessSession(
  freshness: RepositoryFreshnessService | undefined,
  writer: Pick<EnvironmentWebSocketWriter, "send">,
  capabilities: ReadonlyMap<string, number>,
  access: ReadonlySet<EnvironmentAccessCapability>,
  run: (effect: Effect.Effect<void>) => unknown,
) {
  const subscriptions = new Map<string, Subscription>();
  const requests = new Set<string>();
  let closed = false;
  const fail = (requestId: string, detail: string) =>
    writer.send({
      _tag: "RepositoryHistoryFailed",
      requestId,
      failure: { _tag: "GitFailed", reason: "Failed", detail },
    });
  const handle = (message: RepositoryFreshnessClientMessage) => {
    if (message._tag === "UnsubscribeRepositoryHistory") {
      return Effect.sync(() => {
        subscriptions.get(message.repositoryId)?.release?.();
        subscriptions.delete(message.repositoryId);
      });
    }
    if (
      !capabilities.has("repository-history-freshness") ||
      freshness === undefined
    )
      return fail(
        message.requestId,
        "Repository history freshness is unavailable",
      );
    const required =
      message._tag === "SubscribeRepositoryHistory"
        ? "repository.read"
        : "repository.write";
    if (!access.has(required))
      return writer.send({
        _tag: "RepositoryHistoryFailed",
        requestId: message.requestId,
        failure: { _tag: "AuthorizationDenied" },
      });
    if (requests.size >= 32 || requests.has(message.requestId))
      return fail(
        message.requestId,
        "Too many concurrent repository freshness requests",
      );
    if (message._tag === "SubscribeRepositoryHistory") {
      if (subscriptions.size >= 32 || subscriptions.has(message.repositoryId))
        return fail(
          message.requestId,
          "Repository history is already subscribed or subscription limit reached",
        );
      const subscription: Subscription = {};
      subscriptions.set(message.repositoryId, subscription);
      return Effect.sync(() => {
        run(
          freshness
            .subscribe(message.repositoryId, (state) => {
              if (
                !closed &&
                subscriptions.get(message.repositoryId) === subscription
              )
                run(
                  writer
                    .send({
                      _tag: "RepositoryHistoryFreshness",
                      repositoryId: message.repositoryId,
                      requestId: message.requestId,
                      freshness: state,
                    })
                    .pipe(Effect.catch(() => Effect.void)),
                );
            })
            .pipe(
              Effect.tap((release) =>
                Effect.sync(() => {
                  if (
                    closed ||
                    subscriptions.get(message.repositoryId) !== subscription
                  )
                    release();
                  else subscription.release = release;
                }),
              ),
              Effect.catch((error) => {
                if (subscriptions.get(message.repositoryId) === subscription)
                  subscriptions.delete(message.repositoryId);
                return writer.send({
                  _tag: "RepositoryHistoryFailed",
                  requestId: message.requestId,
                  failure: error.failure,
                });
              }),
              Effect.asVoid,
              Effect.catch(() => Effect.void),
            ),
        );
      });
    }
    if (!subscriptions.has(message.repositoryId))
      return fail(
        message.requestId,
        "Subscribe to repository history before fetching or configuring it",
      );
    const operation =
      message._tag === "FetchRepositoryHistory"
        ? freshness.fetch(message.repositoryId)
        : freshness.configure(message.repositoryId, message.setting);
    return Effect.sync(() => {
      requests.add(message.requestId);
      run(
        operation.pipe(
          Effect.flatMap((state) =>
            writer.send({
              _tag: "RepositoryHistoryFreshness",
              repositoryId: message.repositoryId,
              requestId: message.requestId,
              freshness: state,
            }),
          ),
          Effect.catch((error) =>
            "failure" in error
              ? writer.send({
                  _tag: "RepositoryHistoryFailed",
                  requestId: message.requestId,
                  failure: error.failure,
                })
              : Effect.void,
          ),
          Effect.catch(() => Effect.void),
          Effect.ensuring(
            Effect.sync(() => {
              requests.delete(message.requestId);
            }),
          ),
        ),
      );
    });
  };
  return Effect.acquireRelease(Effect.succeed(handle), () =>
    Effect.sync(() => {
      closed = true;
      for (const subscription of subscriptions.values())
        subscription.release?.();
      subscriptions.clear();
    }),
  );
}

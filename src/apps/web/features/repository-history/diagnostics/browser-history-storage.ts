import { Effect } from "effect";
import {
  acquireSharedWorker,
  discardSharedWorker,
} from "#web/features/repository-history/browser-repository-history-reader";
import type {
  HistoryStorageRequest,
  HistoryStorageResponse,
} from "#web/features/repository-history/diagnostics/history-storage.contract";
import { RepositoryHistoryUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryHistoryStorageDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";

export function manageBrowserHistoryStorage(
  operation: HistoryStorageRequest["operation"],
) {
  return Effect.callback<
    RepositoryHistoryStorageDiagnostics,
    RepositoryHistoryUnavailable
  >((resume) => {
    const channel = new MessageChannel();
    let worker: SharedWorker | undefined;
    let settled = false;
    const finish = (
      result: Effect.Effect<
        RepositoryHistoryStorageDiagnostics,
        RepositoryHistoryUnavailable
      >,
    ) => {
      if (settled) return;
      cleanup();
      resume(result);
    };
    const fail = () => finish(Effect.fail(new RepositoryHistoryUnavailable()));
    const failWorker = () => {
      if (settled) return;
      discardSharedWorker(worker);
      worker?.port.close();
      fail();
    };
    const cleanup = () => {
      if (settled) return;
      settled = true;
      worker?.removeEventListener("error", failWorker);
      channel.port1.close();
      channel.port2.close();
    };
    channel.port1.onmessage = (event: MessageEvent<HistoryStorageResponse>) => {
      if (event.data._tag === "HistoryStorageResult")
        finish(Effect.succeed(event.data.diagnostics));
      else if (event.data._tag === "WorkerFailed") failWorker();
      else fail();
    };
    channel.port1.onmessageerror = fail;
    try {
      worker = acquireSharedWorker();
      worker.addEventListener("error", failWorker);
      channel.port1.start();
      worker.port.postMessage(
        {
          _tag: "HistoryStorageRequest",
          operation,
          port: channel.port2,
        } satisfies HistoryStorageRequest,
        [channel.port2],
      );
      worker.port.start();
    } catch {
      failWorker();
    }
    return Effect.sync(cleanup);
  });
}

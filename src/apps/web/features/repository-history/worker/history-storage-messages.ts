import type {
  HistoryStorageRequest,
  HistoryStorageResponse,
} from "#web/features/repository-history/diagnostics/history-storage.contract";
import {
  clearAllHistoryCaches,
  readCacheDiagnostics,
} from "#web/features/repository-history/worker/cache-lifecycle";

const pending = new Set<MessagePort>();

export function failHistoryStorageRequests() {
  for (const port of pending) {
    port.postMessage({ _tag: "WorkerFailed" } satisfies HistoryStorageResponse);
    port.close();
  }
  pending.clear();
}

export async function handleHistoryStorageRequest(
  request: HistoryStorageRequest,
) {
  pending.add(request.port);
  try {
    if (request.operation === "clear") await clearAllHistoryCaches();
    request.port.postMessage({
      _tag: "HistoryStorageResult",
      diagnostics: await readCacheDiagnostics(),
    } satisfies HistoryStorageResponse);
  } catch {
    request.port.postMessage({
      _tag: "HistoryStorageFailed",
    } satisfies HistoryStorageResponse);
  } finally {
    pending.delete(request.port);
    request.port.close();
  }
}

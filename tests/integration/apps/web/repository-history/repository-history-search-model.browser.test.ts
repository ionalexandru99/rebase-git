import { describe, expect, it, vi } from "vitest";
import type { RepositoryHistorySearch } from "#web/features/repository-history/search/repository-history-search.contract";
import { createRepositoryHistorySearchModel } from "#web/features/repository-history/search/repository-history-search-model";

describe("history search runtime", () => {
  it("interrupts replaced requests and releases MessagePort listeners on disposal", async () => {
    const channel = new MessageChannel();
    const requests: string[] = [];
    const released: string[] = [];
    channel.port2.onmessage = (event: MessageEvent<string>) => {
      requests.push(event.data);
    };
    const reader: RepositoryHistorySearch = {
      search: (query, signal) =>
        new Promise((resolve, reject) => {
          const receive = () => {
            cleanup();
            resolve({
              commits: [],
              replicaComplete: true,
              synchronizedCommitCount: 10,
            });
          };
          const abort = () => {
            cleanup();
            reject(signal?.reason);
          };
          const cleanup = () => {
            released.push(query.text);
            channel.port1.removeEventListener("message", receive);
            signal?.removeEventListener("abort", abort);
          };
          channel.port1.addEventListener("message", receive);
          channel.port1.start();
          signal?.addEventListener("abort", abort, { once: true });
          channel.port1.postMessage(query.text);
        }),
    };
    const model = createRepositoryHistorySearchModel(reader, async () => {});
    const publish = vi.fn();
    model.subscribe(publish);
    try {
      model.setText("old");
      await vi.waitFor(() => expect(requests).toEqual(["old"]));
      model.setText("new");
      await vi.waitFor(() => expect(requests).toEqual(["old", "new"]));
      expect(released).toEqual(["old"]);
      await model.dispose();
      expect(released).toEqual(["old", "new"]);
      const publications = publish.mock.calls.length;
      channel.port2.postMessage("late result");
      model.setText("after disposal");
      await model.dispose();
      expect(publish).toHaveBeenCalledTimes(publications);
      expect(model.getSnapshot().error).toBeUndefined();
    } finally {
      await model.dispose();
      channel.port1.close();
      channel.port2.close();
    }
  });
});

import type {
  RepositoryHistoryRefTarget,
  RepositoryHistoryTips,
} from "@rebase/contracts";
import {
  clearRepository,
  HistoryStorageUnavailable,
  openRepository,
  readCommitChunk,
  readCommits,
  readTopology,
  type StoredRepository,
  storeCommits,
  updateRepository,
  writeTopology,
} from "#web/features/repository-history/history-database";
import { HistoryGraph } from "#web/features/repository-history/history-graph";
import { searchHistory } from "#web/features/repository-history/history-search";
import {
  findInHistory,
  type HistoryScopeQuery,
  HistoryView,
} from "#web/features/repository-history/history-view";
import type {
  HistoryFailure,
  HistoryRows,
  HistorySearchPage,
  HistorySnapshot,
} from "#web/features/repository-history/history-worker-protocol";
import { writeWithEviction } from "#web/features/repository-history/worker/history-storage";
import type { EnvironmentSocket } from "#web/platform/environment/environment-connection";

const epochSize = 2 ** 32;
const cachedViews = 4;

export interface HistorySync {
  readonly socket: EnvironmentSocket;
  readonly repositoryId: string;
}

export class HistoryReplica {
  private record: StoredRepository | undefined;
  private graph = new HistoryGraph();
  private refTargets: readonly RepositoryHistoryRefTarget[] = [];
  private synchronization: HistorySnapshot["synchronization"] = "idle";
  private failure: HistoryFailure | undefined;
  private revision = 0;
  private views = new Map<string, HistoryView>();
  private paused = false;
  private loading: Promise<void>;
  private running: AbortController | undefined;
  private task: Promise<void> = Promise.resolve();
  private requested: HistorySync | undefined;

  constructor(
    readonly environmentId: string,
    readonly repositoryId: string,
    private readonly publish: (snapshot: HistorySnapshot) => void,
    private readonly isOpen: (
      environmentId: string,
      repositoryId: string,
    ) => boolean,
  ) {
    this.loading = this.load();
  }

  snapshot(): HistorySnapshot {
    const commitCount = this.graph.size;
    const status =
      commitCount > 0
        ? "ready"
        : this.failure !== undefined
          ? "error"
          : this.paused ||
              (this.record?.tips !== undefined &&
                this.synchronization !== "syncing")
            ? "empty"
            : "loading";
    return {
      revision: this.revision,
      status,
      synchronization: this.synchronization,
      commitCount,
      refTargets: this.refTargets,
      ...(this.failure === undefined ? {} : { failure: this.failure }),
    };
  }

  synchronize(sync: HistorySync) {
    this.requested = sync;
    if (this.running !== undefined) return;
    const controller = new AbortController();
    this.running = controller;
    this.task = (async () => {
      await this.loading;
      for (
        let next = this.requested;
        next !== undefined && !controller.signal.aborted;
        next = this.requested
      ) {
        this.requested = undefined;
        await this.synchronizeOnce(next, controller.signal);
      }
      if (this.running === controller) this.running = undefined;
    })();
  }

  offline() {
    if (this.running !== undefined) return;
    this.fail({ _tag: "Offline" });
  }

  close() {
    this.running?.abort();
    this.running = undefined;
    this.requested = undefined;
    return this.task;
  }

  async rows(
    scope: HistoryScopeQuery,
    requestedStart: number,
    requestedEnd: number,
    anchor?: { readonly oid: string; readonly index: number },
  ): Promise<HistoryRows> {
    const view = await this.view(scope);
    const found = anchor === undefined ? undefined : view.row(anchor.oid);
    const shift =
      anchor === undefined || found === undefined ? 0 : found - anchor.index;
    const start = Math.max(0, requestedStart + shift);
    const end = Math.min(requestedEnd + shift, start + 1_000);
    const rows = view.rows(start, end);
    const record = this.record;
    const commits =
      record === undefined
        ? []
        : await readCommits(
            record.id,
            rows.map((row) => row.oid),
          );
    const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
    return {
      total: view.total,
      start,
      shift,
      rows: rows.flatMap((row) => {
        const commit = byOid.get(row.oid);
        return commit === undefined ? [] : [{ ...row, commit }];
      }),
    };
  }

  async oids(scope: HistoryScopeQuery, start: number, end: number) {
    return (await this.view(scope)).oids(start, end);
  }

  async locate(scope: HistoryScopeQuery, oids: readonly string[]) {
    const view = await this.view(scope);
    return oids.map((oid) => view.row(oid));
  }

  async find(scope: HistoryScopeQuery, oid: string) {
    await this.loading;
    return findInHistory(this.graph, this.refTargets, scope, oid, (next) =>
      this.cachedView(next),
    );
  }

  async search(
    query: {
      readonly text: string;
      readonly limit: number;
      readonly cursor?: string;
    },
    signal: AbortSignal,
  ): Promise<HistorySearchPage> {
    await this.loading;
    const record = this.record;
    const page =
      record === undefined
        ? { commits: [] }
        : await searchHistory(record.id, this.refTargets, query, signal);
    return {
      ...page,
      complete:
        record?.tips !== undefined && this.synchronization !== "syncing",
      commitCount: this.graph.size,
    };
  }

  async commits(oids: readonly string[]) {
    await this.loading;
    const record = this.record;
    return record === undefined ? [] : readCommits(record.id, oids);
  }

  async clear(remove: boolean) {
    await this.close();
    await this.loading;
    await clearRepository(this.environmentId, this.repositoryId, remove);
    this.reset();
    this.paused = true;
    this.record = undefined;
    this.bump();
  }

  async rebuild() {
    await this.clear(false);
    this.paused = false;
    this.loading = this.load();
    await this.loading;
  }

  private async load() {
    try {
      const record = await openRepository(
        this.environmentId,
        this.repositoryId,
      );
      const topology = await readTopology(record.id);
      this.graph =
        topology === undefined
          ? await this.readGraph(record.id)
          : HistoryGraph.fromTopology(topology);
      if (topology === undefined && this.graph.size > 0)
        void writeTopology(record.id, this.graph.topology()).catch(
          () => undefined,
        );
      this.record = record;
      this.refTargets = record.tips?.refTargets ?? [];
      this.synchronization = record.tips === undefined ? "idle" : "complete";
    } catch (error) {
      this.failure = historyFailure(error);
    }
    this.bump();
  }

  private async readGraph(repository: number) {
    const graph = new HistoryGraph();
    for (let after: string | undefined; ; ) {
      const chunk = await readCommitChunk(repository, after, 2_048);
      for (const record of chunk)
        graph.add(record.commit, record.epoch * epochSize + record.order);
      const last = chunk.at(-1);
      if (chunk.length < 2_048 || last === undefined) return graph;
      after = last.commit.oid;
    }
  }

  private async synchronizeOnce(sync: HistorySync, signal: AbortSignal) {
    const current = this.record;
    if (this.paused || current === undefined) return;
    this.synchronization = "syncing";
    this.bump();
    let record: StoredRepository = {
      ...current,
      minimumEpoch: current.minimumEpoch - 1,
    };
    const epoch = record.minimumEpoch;
    let order = 0;
    let tips: RepositoryHistoryTips | undefined;
    try {
      await updateRepository(record);
      await sync.socket.synchronizeHistory(
        {
          repositoryId: sync.repositoryId,
          knownTips: current.tips?.rootOids ?? [],
          shallowOids: current.tips?.shallowOids ?? [],
        },
        async (update) => {
          if (signal.aborted) throw signal.reason;
          if (update._tag === "RepositoryHistoryTips") {
            tips = update;
            this.refTargets = update.refTargets;
            this.bump();
            return;
          }
          const stored = update.commits.map((commit) => ({
            commit,
            epoch,
            order: order++,
          }));
          record = {
            ...record,
            commitCount:
              this.graph.size +
              stored.filter(({ commit }) => !this.graph.has(commit.oid)).length,
          };
          const written = record;
          await writeWithEviction(
            () => storeCommits(written, stored),
            this.isOpen,
          );
          if (signal.aborted) throw signal.reason;
          this.record = record;
          for (const { commit, order } of stored)
            this.graph.add(commit, epoch * epochSize + order);
          this.bump();
        },
        signal,
      );
      if (tips === undefined)
        throw new Error("The server sent no history tips");
      record = { ...record, tips, commitCount: this.graph.size };
      await updateRepository(record);
      if (signal.aborted) return;
      this.record = record;
      this.refTargets = tips.refTargets;
      this.synchronization = "complete";
      this.failure = undefined;
      if (order > 0)
        void writeTopology(record.id, this.graph.topology()).catch(
          () => undefined,
        );
    } catch (error) {
      if (signal.aborted) return;
      this.failure = historyFailure(error);
      this.synchronization = this.record?.tips === undefined ? "idle" : "stale";
    }
    this.bump();
  }

  private async view(scope: HistoryScopeQuery) {
    await this.loading;
    return this.cachedView(scope);
  }

  private cachedView(scope: HistoryScopeQuery) {
    const key = JSON.stringify(scope);
    const cached = this.views.get(key);
    if (cached !== undefined) {
      this.views.delete(key);
      this.views.set(key, cached);
      return cached;
    }
    const view = new HistoryView(this.graph, scope, this.refTargets);
    this.views.set(key, view);
    for (const oldest of this.views.keys()) {
      if (this.views.size <= cachedViews) break;
      this.views.delete(oldest);
    }
    return view;
  }

  private fail(failure: HistoryFailure) {
    this.failure = failure;
    this.bump();
  }

  private reset() {
    this.graph = new HistoryGraph();
    this.refTargets = [];
    this.synchronization = "idle";
    this.failure = undefined;
  }

  private bump() {
    this.revision += 1;
    this.views.clear();
    this.publish(this.snapshot());
  }
}

export function historyFailure(error: unknown): HistoryFailure {
  if (error instanceof HistoryStorageUnavailable)
    return { _tag: "StorageUnavailable" };
  if (typeof error === "object" && error !== null && "_tag" in error) {
    if (error._tag === "Unanswered") return { _tag: "Offline" };
    if (error._tag === "Rejected" && "failure" in error)
      return {
        _tag: "Rejected",
        failure: error.failure as Extract<
          HistoryFailure,
          { _tag: "Rejected" }
        >["failure"],
      };
  }
  return { _tag: "Unavailable" };
}

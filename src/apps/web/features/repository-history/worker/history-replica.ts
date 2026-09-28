import type {
  RepositoryHistoryRefTarget,
  RepositoryHistoryTips,
} from "#contracts/repository-history/repository-history.contract.ts";
import {
  clearRepository,
  HistoryStorageUnavailable,
  historyRank,
  openRepository,
  readCommitChunk,
  readCommits,
  readTopology,
  type StoredRepository,
  storeCommits,
  updateRepository,
  writeTopology,
} from "#web/features/repository-history/history-database.ts";
import { HistoryGraph } from "#web/features/repository-history/history-graph.ts";
import { searchHistory } from "#web/features/repository-history/history-search.ts";
import {
  findInHistory,
  type HistoryScopeQuery,
  HistoryView,
} from "#web/features/repository-history/history-view.ts";
import type {
  HistoryFailure,
  HistoryRows,
  HistorySearchPage,
  HistorySnapshot,
} from "#web/features/repository-history/history-worker-protocol.ts";
import { writeWithEviction } from "#web/features/repository-history/worker/history-storage.ts";
import type { EnvironmentSocket } from "#web/platform/environment/environment-connection.ts";

const cachedViews = 4;
const recentTopologyShare = 16;

export interface HistorySync {
  readonly socket: EnvironmentSocket;
  readonly repositoryId: string;
}

interface CachedView {
  readonly view: HistoryView;
  readonly revision: number;
}

export class HistoryReplica {
  private record: StoredRepository | undefined;
  private graph = new HistoryGraph();
  private refTargets: readonly RepositoryHistoryRefTarget[] = [];
  private synchronization: HistorySnapshot["synchronization"] = "idle";
  private failure: HistoryFailure | undefined;
  private revision = 0;
  private views = new Map<string, CachedView>();
  private savedTopology = false;
  private recentTopology = 0;
  private writing: Promise<void> = Promise.resolve();
  private paused = false;
  private closed = false;
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
    if (this.paused || this.closed) return;
    this.requested = sync;
    if (this.running !== undefined) return;
    const controller = new AbortController();
    this.running = controller;
    this.task = (async () => {
      await this.loading;
      await this.writing;
      for (
        let next = this.requested;
        next !== undefined && !controller.signal.aborted;
        next = this.requested
      ) {
        this.requested = undefined;
        await this.synchronizeOnce(next, controller.signal);
        if (!controller.signal.aborted) await this.saveTopology();
      }
      if (this.running === controller) this.running = undefined;
    })();
  }

  offline() {
    if (this.paused || this.closed || this.running !== undefined) return;
    this.failure = { _tag: "Offline" };
    if (this.synchronization === "complete") this.synchronization = "stale";
    this.announce();
  }

  close() {
    this.closed = true;
    return this.stop();
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

  async relation(from: string, to: string) {
    await this.loading;
    return this.graph.relation(from, to);
  }

  async commits(oids: readonly string[]) {
    await this.loading;
    const record = this.record;
    return record === undefined ? [] : readCommits(record.id, oids);
  }

  async clear(remove: boolean) {
    this.paused = true;
    await this.stop();
    await this.loading;
    await this.writing;
    await clearRepository(this.environmentId, this.repositoryId, remove);
    this.reset();
    this.record = undefined;
    this.changed();
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
          : HistoryGraph.fromTopology(topology.saved);
      for (const entry of topology?.recent ?? [])
        this.graph.add(entry.commit, historyRank(entry));
      this.savedTopology = topology !== undefined;
      this.recentTopology = topology?.recent.length ?? 0;
      this.views.clear();
      this.record = record;
      this.refTargets = record.tips?.refTargets ?? [];
      this.synchronization = record.tips === undefined ? "idle" : "complete";
      void this.saveTopology();
    } catch (error) {
      this.failure = historyFailure(error);
    }
    this.changed();
  }

  private async readGraph(repository: number) {
    const graph = new HistoryGraph();
    for (let after: string | undefined; ; ) {
      const chunk = await readCommitChunk(repository, after, 2_048);
      for (const record of chunk) graph.add(record.commit, historyRank(record));
      const last = chunk.at(-1);
      if (chunk.length < 2_048 || last === undefined) return graph;
      after = last.commit.oid;
    }
  }

  private async synchronizeOnce(sync: HistorySync, signal: AbortSignal) {
    const current = this.record;
    if (this.paused || this.closed || current === undefined) return;
    this.synchronization = "syncing";
    this.announce();
    let record: StoredRepository = {
      ...current,
      minimumEpoch: current.minimumEpoch - 1,
    };
    const epoch = record.minimumEpoch;
    const incremental = current.tips !== undefined;
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
            if (current.tips === undefined)
              this.applyRefTargets(update.refTargets);
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
          for (const commit of stored)
            this.graph.add(commit.commit, historyRank(commit));
          if (this.savedTopology) this.recentTopology += stored.length;
          if (stored.length > 0 && !incremental) this.changed();
        },
        signal,
      );
      if (tips === undefined)
        throw new Error("The server sent no history tips");
      record = { ...record, tips, commitCount: this.graph.size };
      await updateRepository(record);
      if (signal.aborted) return;
      this.record = record;
      this.synchronization = "complete";
      this.failure = undefined;
      if (incremental && order > 0) this.revision += 1;
      this.applyRefTargets(tips.refTargets);
    } catch (error) {
      if (signal.aborted) return;
      this.failure = historyFailure(error);
      this.synchronization = this.graph.size > 0 ? "stale" : "idle";
      if (incremental && order > 0) this.revision += 1;
      this.announce();
    }
  }

  private saveTopology() {
    const record = this.record;
    if (
      record === undefined ||
      this.graph.size === 0 ||
      (this.savedTopology &&
        this.recentTopology * recentTopologyShare < this.graph.size)
    )
      return this.writing;
    const topology = this.graph.topology();
    this.writing = writeTopology(record.id, topology).then(
      () => {
        this.savedTopology = true;
        this.recentTopology = 0;
      },
      () => undefined,
    );
    return this.writing;
  }

  private stop() {
    this.running?.abort();
    this.requested = undefined;
    return this.task;
  }

  private applyRefTargets(refTargets: readonly RepositoryHistoryRefTarget[]) {
    if (sameRefTargets(this.refTargets, refTargets)) {
      this.announce();
      return;
    }
    this.refTargets = refTargets;
    this.views.clear();
    this.changed();
  }

  private async view(scope: HistoryScopeQuery) {
    await this.loading;
    return this.cachedView(scope);
  }

  private cachedView(scope: HistoryScopeQuery) {
    const key = JSON.stringify(scope);
    const cached = this.views.get(key);
    this.views.delete(key);
    const view =
      cached?.revision === this.revision
        ? cached.view
        : new HistoryView(this.graph, scope, this.refTargets, cached?.view);
    this.views.set(key, { view, revision: this.revision });
    for (const oldest of this.views.keys()) {
      if (this.views.size <= cachedViews) break;
      this.views.delete(oldest);
    }
    return view;
  }

  private reset() {
    this.graph = new HistoryGraph();
    this.views.clear();
    this.savedTopology = false;
    this.recentTopology = 0;
    this.refTargets = [];
    this.synchronization = "idle";
    this.failure = undefined;
  }

  private changed() {
    this.revision += 1;
    this.announce();
  }

  private announce() {
    this.publish(this.snapshot());
  }
}

function sameRefTargets(
  left: readonly RepositoryHistoryRefTarget[],
  right: readonly RepositoryHistoryRefTarget[],
) {
  return (
    left.length === right.length &&
    left.every((ref, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.type === ref.type &&
        other.name === ref.name &&
        other.oid === ref.oid
      );
    })
  );
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

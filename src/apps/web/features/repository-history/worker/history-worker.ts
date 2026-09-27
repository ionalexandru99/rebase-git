import type { RepositoryChangeKind } from "@rebase/contracts";
import {
  clearRepository,
  readRepositories,
} from "#web/features/repository-history/history-database";
import {
  holdLease,
  watchLease,
} from "#web/features/repository-history/history-lease";
import type {
  HistoryClientMessage,
  HistoryIdentity,
  HistoryPortOffer,
  HistoryQuery,
  HistoryWorkerLease,
  HistoryWorkerMessage,
} from "#web/features/repository-history/history-worker-protocol";
import {
  HistoryReplica,
  historyFailure,
} from "#web/features/repository-history/worker/history-replica";
import { describeHistoryStorage } from "#web/features/repository-history/worker/history-storage";
import {
  type EnvironmentAccess,
  type EnvironmentSocket,
  openEnvironmentSocket,
  reconnectDelay,
} from "#web/platform/environment/environment-connection";

interface HistoryClient {
  readonly port: MessagePort;
  readonly lease: string | undefined;
  readonly questions: Map<number, AbortController>;
  identity?: HistoryIdentity;
  environment?: EnvironmentAccess;
  replica?: HistoryReplica;
}

interface SocketEntry {
  readonly socket: Promise<EnvironmentSocket | undefined>;
  live: boolean;
}

const replicas = new Map<string, HistoryReplica>();
const clients = new Set<HistoryClient>();
const sockets = new Map<string, SocketEntry>();
const failedConnections = new Map<string, number>();
const reconnects = new Set<string>();
const leases = new Map<string, AbortController>();
const workerLease = holdLease("rebase-history-worker");

const worker = self as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};

worker.onconnect = (event) => {
  const shared = event.ports[0];
  if (shared === undefined) return;
  shared.onmessage = (message: MessageEvent<HistoryPortOffer>) => {
    const port = message.ports[0];
    if (port !== undefined) attach(port, message.data.lease);
  };
  shared.start();
  void workerLease.then((lease) => {
    if (lease !== undefined)
      shared.postMessage({ lease } satisfies HistoryWorkerLease);
  });
};

function attach(port: MessagePort, lease: string | undefined) {
  const client: HistoryClient = { port, lease, questions: new Map() };
  clients.add(client);
  if (lease !== undefined && !leases.has(lease)) {
    const watch = new AbortController();
    leases.set(lease, watch);
    watchLease(lease, () => release(lease), watch.signal);
  }
  port.onmessage = (message: MessageEvent<HistoryClientMessage>) =>
    receive(client, message.data);
  port.start();
}

function receive(client: HistoryClient, message: HistoryClientMessage) {
  switch (message._tag) {
    case "Open":
      open(client, message.identity, message.environment);
      return;
    case "Connect":
      client.environment = message.environment;
      void connect(message.environment);
      synchronize(client);
      return;
    case "Synchronize":
      synchronize(client);
      return;
    case "Ask":
      void answer(client, message.id, message.query);
      return;
    case "Cancel":
      client.questions.get(message.id)?.abort();
      return;
    case "Close":
      close(client);
      return;
  }
}

function open(
  client: HistoryClient,
  identity: HistoryIdentity,
  environment: EnvironmentAccess | undefined,
) {
  const key = replicaKey(identity.environmentId, identity.logicalRepositoryId);
  let replica = replicas.get(key);
  if (replica === undefined) {
    const created = new HistoryReplica(
      identity.environmentId,
      identity.logicalRepositoryId,
      (snapshot) => {
        for (const current of clients)
          if (current.replica === created)
            post(current, { _tag: "Snapshot", snapshot });
      },
      (environmentId, repositoryId) =>
        replicas.has(replicaKey(environmentId, repositoryId)),
    );
    replica = created;
    replicas.set(key, replica);
  }
  client.identity = identity;
  client.replica = replica;
  if (environment !== undefined) client.environment = environment;
  post(client, { _tag: "Snapshot", snapshot: replica.snapshot() });
  synchronize(client);
}

function release(lease: string) {
  leases.delete(lease);
  for (const client of [...clients]) if (client.lease === lease) close(client);
}

function close(client: HistoryClient) {
  if (!clients.delete(client)) return;
  const lease = client.lease;
  if (
    lease !== undefined &&
    ![...clients].some((current) => current.lease === lease)
  ) {
    leases.get(lease)?.abort();
    leases.delete(lease);
  }
  for (const question of client.questions.values()) question.abort();
  client.port.close();
  const replica = client.replica;
  if (replica === undefined) return;
  if ([...clients].some((current) => current.replica === replica)) return;
  void replica.close();
  replicas.delete(replicaKey(replica.environmentId, replica.repositoryId));
}

function synchronize(client: HistoryClient) {
  const { replica, environment, identity } = client;
  if (
    replica === undefined ||
    environment === undefined ||
    identity === undefined
  )
    return;
  void connect(environment).then((socket) => {
    if (socket === undefined) replica.offline();
    else if (socket.environmentId === identity.environmentId)
      replica.synchronize({ socket, repositoryId: identity.repositoryId });
  });
}

function synchronizeOrigin(
  environment: EnvironmentAccess,
  repositoryIds?: readonly string[],
) {
  const synchronized = new Set<HistoryReplica>();
  for (const client of clients) {
    if (
      client.replica === undefined ||
      client.environment?.origin !== environment.origin ||
      synchronized.has(client.replica) ||
      (repositoryIds !== undefined &&
        !repositoryIds.includes(client.identity?.repositoryId ?? ""))
    )
      continue;
    synchronized.add(client.replica);
    synchronize(client);
  }
}

function connect(environment: EnvironmentAccess) {
  const origin = environment.origin;
  const current = sockets.get(origin);
  if (current?.live) return current.socket;
  const entry: SocketEntry = {
    live: true,
    socket: openEnvironmentSocket(origin, environment.credential, {
      changed: (repositoryIds, kind) =>
        refsChanged(environment, repositoryIds, kind),
    }).then(
      (socket) => {
        failedConnections.delete(origin);
        void socket.closed.then(() => disconnected(origin, entry));
        return socket;
      },
      () => {
        disconnected(origin, entry);
        return undefined;
      },
    ),
  };
  sockets.set(origin, entry);
  return entry.socket;
}

function disconnected(origin: string, entry: SocketEntry) {
  entry.live = false;
  if (sockets.get(origin) !== entry || reconnects.has(origin)) return;
  const waiting = [...clients].filter(
    (client) =>
      client.replica !== undefined && client.environment?.origin === origin,
  );
  if (waiting.length === 0) return;
  for (const client of waiting) client.replica?.offline();
  const attempt = (failedConnections.get(origin) ?? 0) + 1;
  failedConnections.set(origin, attempt);
  reconnects.add(origin);
  setTimeout(() => {
    reconnects.delete(origin);
    const environment = [...clients].find(
      (client) =>
        client.replica !== undefined && client.environment?.origin === origin,
    )?.environment;
    if (environment !== undefined) synchronizeOrigin(environment);
  }, reconnectDelay(attempt));
}

function refsChanged(
  environment: EnvironmentAccess,
  repositoryIds: readonly string[] | undefined,
  kind: RepositoryChangeKind | undefined,
) {
  if (kind !== undefined && kind !== "Refs") return;
  synchronizeOrigin(environment, repositoryIds);
}

async function answer(client: HistoryClient, id: number, query: HistoryQuery) {
  const controller = new AbortController();
  client.questions.set(id, controller);
  try {
    const value = await ask(client, query, controller.signal);
    if (!controller.signal.aborted) post(client, { _tag: "Answer", id, value });
  } catch (error) {
    if (!controller.signal.aborted)
      post(client, { _tag: "Failed", id, failure: historyFailure(error) });
  } finally {
    client.questions.delete(id);
  }
}

async function ask(
  client: HistoryClient,
  query: HistoryQuery,
  signal: AbortSignal,
): Promise<unknown> {
  if (query._tag === "Storage") return manageStorage(client, query.action);
  const replica = client.replica;
  if (replica === undefined) throw new Error("History is not open");
  switch (query._tag) {
    case "Rows":
      return replica.rows(query.scope, query.start, query.end, query.anchor);
    case "Oids":
      return replica.oids(query.scope, query.start, query.end);
    case "Locate":
      return replica.locate(query.scope, query.oids);
    case "Find":
      return replica.find(query.scope, query.oid);
    case "Search":
      return replica.search(query, signal);
    case "Commits":
      return replica.commits(query.oids);
  }
}

async function manageStorage(
  client: HistoryClient,
  action: Extract<HistoryQuery, { _tag: "Storage" }>["action"],
) {
  const replica = client.replica;
  if (action === "clear-all") {
    for (const current of replicas.values()) await current.clear(false);
    for (const record of await readRepositories())
      await clearRepository(record.environmentId, record.repositoryId, false);
  } else if (action !== "inspect") {
    if (replica === undefined) throw new Error("History is not open");
    if (action === "rebuild") {
      await replica.rebuild();
      synchronize(client);
    } else await replica.clear(action === "remove");
  }
  return describeHistoryStorage((environmentId, repositoryId) =>
    replicas.has(replicaKey(environmentId, repositoryId)),
  );
}

function post(client: HistoryClient, message: HistoryWorkerMessage) {
  client.port.postMessage(message);
}

function replicaKey(environmentId: string, repositoryId: string) {
  return `${environmentId}\0${repositoryId}`;
}

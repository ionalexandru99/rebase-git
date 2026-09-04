import {
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  type RepositoryCommit,
} from "@rebase/contracts";
import { RepositoryHistoryEpoch } from "#web/features/repository-history/repository-history-epoch";
import {
  readRepositoryCommits,
  storeRepositoryCommits,
} from "#web/features/repository-history/repository-history-store";
import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerRequest,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/repository-history-worker.contract";

const repositories = new Map<string, RepositoryReplica>();
const worker = self as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};

worker.onconnect = (event) => {
  const sharedPort = event.ports[0];
  if (sharedPort === undefined) {
    return;
  }
  sharedPort.onmessage = (
    message: MessageEvent<ConnectRepositoryHistoryReader>,
  ) => {
    if (message.data._tag !== "ConnectRepositoryHistoryReader") {
      return;
    }
    connectReader(message.data);
  };
  sharedPort.start();
};

function connectReader(connection: ConnectRepositoryHistoryReader) {
  const key = `${connection.environmentId}\0${connection.repositoryId}`;
  const replica = repositories.get(key) ?? createReplica();
  const reader: ConnectedReader = {
    closed: false,
    connection,
    epoch: new RepositoryHistoryEpoch(),
  };
  replica.readers.add(reader);
  repositories.set(key, replica);
  connection.port.onmessage = (
    event: MessageEvent<RepositoryHistoryWorkerRequest>,
  ) => {
    void handleReaderMessage(reader, replica, event.data).catch(() => {
      if (event.data._tag === "HistoryBatchReceived") {
        replica.synchronization = "idle";
        delete replica.synchronizationOwner;
        delete replica.synchronizationRequestId;
        replica.revision += 1;
        publishSnapshot(replica);
        post(reader, {
          _tag: "HistoryBatchFailed",
          batchId: event.data.batchId,
        });
        return;
      }
      if (!("requestId" in event.data)) {
        return;
      }
      const failure = { _tag: "Unavailable" as const };
      replica.failure = failure;
      replica.status = "error";
      replica.revision += 1;
      publishSnapshot(replica);
      post(reader, {
        _tag: "RequestFailed",
        failure,
        requestId: event.data.requestId,
      });
    });
  };
  connection.port.start();
  postSnapshot(reader, replica);
}

async function handleReaderMessage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: RepositoryHistoryWorkerRequest,
) {
  if (reader.closed) {
    return;
  }
  switch (message._tag) {
    case "ReadHistory": {
      const supersededRequestId = reader.epoch.begin(message.requestId);
      if (supersededRequestId !== undefined) {
        post(reader, {
          _tag: "CancelHistoryLoad",
          requestId: supersededRequestId,
        });
        post(reader, {
          _tag: "RequestFailed",
          failure: { _tag: "Unavailable" },
          requestId: supersededRequestId,
        });
      }
      replica.status = "loading";
      publishSnapshot(replica);
      post(reader, {
        _tag: "LoadHistory",
        query: message.query,
        requestId: message.requestId,
      });
      return;
    }
    case "HistoryPageReceived":
      if (!reader.epoch.isCurrent(message.requestId)) {
        return;
      }
      await acceptHistoryPage(
        reader,
        replica,
        message.requestId,
        message.bytes,
      );
      return;
    case "HistoryPageFailed":
      if (!reader.epoch.finish(message.requestId)) {
        return;
      }
      replica.failure = message.failure;
      replica.status = "error";
      replica.revision += 1;
      publishSnapshot(replica);
      post(reader, {
        _tag: "RequestFailed",
        failure: message.failure,
        requestId: message.requestId,
      });
      return;
    case "HistoryBatchReceived":
      await acceptHistoryBatch(
        reader,
        replica,
        message.requestId,
        message.batchId,
        message.bytes,
      );
      return;
    case "HistorySynchronizationCompleted":
      if (
        replica.synchronizationOwner !== reader ||
        replica.synchronizationRequestId !== message.requestId
      ) {
        return;
      }
      replica.synchronization = "complete";
      replica.synchronizedCommitCount = message.commitCount;
      delete replica.synchronizationOwner;
      delete replica.synchronizationRequestId;
      replica.revision += 1;
      publishSnapshot(replica);
      return;
    case "HistorySynchronizationFailed":
      if (
        replica.synchronizationOwner !== reader ||
        replica.synchronizationRequestId !== message.requestId
      ) {
        return;
      }
      replica.synchronization = "idle";
      delete replica.synchronizationOwner;
      delete replica.synchronizationRequestId;
      replica.revision += 1;
      publishSnapshot(replica);
      return;
    case "GetCommitSummaries": {
      const commits = await readRepositoryCommits(
        reader.connection.environmentId,
        reader.connection.repositoryId,
        message.oids,
      );
      post(reader, {
        _tag: "CommitSummariesResult",
        commits,
        requestId: message.requestId,
      });
      return;
    }
    case "GetRefTargets":
      post(reader, {
        _tag: "RefTargetsResult",
        refs: replica.refTargets,
        requestId: message.requestId,
      });
      return;
    case "CloseReader": {
      const activeRequestId = reader.epoch.cancel();
      if (activeRequestId !== undefined) {
        post(reader, {
          _tag: "CancelHistoryLoad",
          requestId: activeRequestId,
        });
      }
      replica.readers.delete(reader);
      if (replica.synchronizationOwner === reader) {
        cancelSynchronization(reader, replica);
      }
      reader.closed = true;
      if (replica.readers.size === 0) {
        repositories.delete(
          `${reader.connection.environmentId}\0${reader.connection.repositoryId}`,
        );
      } else if (replica.synchronization !== "complete") {
        const replacement = replica.readers.values().next().value;
        if (replacement !== undefined) {
          startSynchronization(replacement, replica);
        }
      }
      reader.connection.port.close();
      return;
    }
  }
}

async function acceptHistoryPage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  requestId: string,
  bytes: Uint8Array,
) {
  try {
    const page = decodeRepositoryHistoryPage(bytes);
    if (page.repositoryId !== reader.connection.repositoryId) {
      throw new Error("History page identity does not match the reader");
    }
    await storeRepositoryCommits(
      reader.connection.environmentId,
      reader.connection.repositoryId,
      page.commits,
    );
    if (!reader.epoch.finish(requestId)) {
      return;
    }
    for (const commit of page.commits) {
      replica.commits.set(commit.oid, commit);
    }
    replica.refTargets = page.refTargets;
    replica.visibleOids = page.commits.map((commit) => commit.oid);
    delete replica.failure;
    replica.status = page.commits.length === 0 ? "empty" : "ready";
    replica.revision += 1;
    publishSnapshot(replica);
    post(reader, {
      _tag: "HistoryResult",
      commits: page.commits,
      requestId,
    });
    if (replica.synchronization === "idle") {
      startSynchronization(reader, replica);
    }
  } catch {
    if (!reader.epoch.finish(requestId)) {
      return;
    }
    const failure = { _tag: "Unavailable" as const };
    replica.failure = failure;
    replica.status = "error";
    replica.revision += 1;
    publishSnapshot(replica);
    post(reader, { _tag: "RequestFailed", failure, requestId });
  }
}

async function acceptHistoryBatch(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  requestId: string,
  batchId: string,
  bytes: Uint8Array,
) {
  if (
    replica.synchronizationOwner !== reader ||
    replica.synchronizationRequestId !== requestId
  ) {
    return;
  }
  const batch = decodeRepositoryHistoryBatch(bytes);
  if (batch.repositoryId !== reader.connection.repositoryId) {
    throw new Error("History batch identity does not match the reader");
  }
  await storeRepositoryCommits(
    reader.connection.environmentId,
    reader.connection.repositoryId,
    batch.commits,
  );
  if (
    replica.synchronizationOwner !== reader ||
    replica.synchronizationRequestId !== requestId
  ) {
    return;
  }
  replica.synchronizedCommitCount += batch.commits.length;
  replica.revision += 1;
  publishSnapshot(replica);
  post(reader, { _tag: "HistoryBatchCommitted", batchId });
}

function startSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  if (reader.closed || replica.synchronization === "syncing") {
    return;
  }
  const requestId = crypto.randomUUID();
  replica.synchronization = "syncing";
  replica.synchronizationOwner = reader;
  replica.synchronizationRequestId = requestId;
  replica.synchronizedCommitCount = 0;
  replica.revision += 1;
  publishSnapshot(replica);
  post(reader, { _tag: "SynchronizeHistory", requestId });
}

function cancelSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  const requestId = replica.synchronizationRequestId;
  if (requestId !== undefined) {
    post(reader, { _tag: "CancelHistorySynchronization", requestId });
  }
  replica.synchronization = "idle";
  delete replica.synchronizationOwner;
  delete replica.synchronizationRequestId;
}

function publishSnapshot(replica: RepositoryReplica) {
  for (const reader of replica.readers) {
    postSnapshot(reader, replica);
  }
}

function postSnapshot(reader: ConnectedReader, replica: RepositoryReplica) {
  post(reader, {
    _tag: "SnapshotChanged",
    ...(replica.failure === undefined ? {} : { failure: replica.failure }),
    revision: replica.revision,
    status: replica.status,
    synchronization: replica.synchronization,
    synchronizedCommitCount: replica.synchronizedCommitCount,
  });
}

function post(
  reader: ConnectedReader,
  message: RepositoryHistoryWorkerResponse,
) {
  if (!reader.closed) {
    reader.connection.port.postMessage(message);
  }
}

function createReplica(): RepositoryReplica {
  return {
    commits: new Map(),
    readers: new Set(),
    refTargets: [],
    revision: 0,
    status: "empty",
    synchronization: "idle",
    synchronizedCommitCount: 0,
    visibleOids: [],
  };
}

interface ConnectedReader {
  closed: boolean;
  readonly connection: ConnectRepositoryHistoryReader;
  readonly epoch: RepositoryHistoryEpoch;
}

interface RepositoryReplica {
  readonly commits: Map<string, RepositoryCommit>;
  failure?: Extract<
    RepositoryHistoryWorkerResponse,
    { _tag: "RequestFailed" }
  >["failure"];
  revision: number;
  refTargets: Extract<
    RepositoryHistoryWorkerResponse,
    { _tag: "RefTargetsResult" }
  >["refs"];
  readonly readers: Set<ConnectedReader>;
  status: "empty" | "error" | "loading" | "ready";
  synchronization: "complete" | "idle" | "syncing";
  synchronizationOwner?: ConnectedReader;
  synchronizationRequestId?: string;
  synchronizedCommitCount: number;
  visibleOids: readonly string[];
}

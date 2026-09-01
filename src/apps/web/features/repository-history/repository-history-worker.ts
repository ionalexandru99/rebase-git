import {
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
  if (sharedPort === undefined) return;
  sharedPort.onmessage = (
    message: MessageEvent<ConnectRepositoryHistoryReader>,
  ) => {
    if (message.data._tag !== "ConnectRepositoryHistoryReader") return;
    connectReader(message.data);
  };
  sharedPort.start();
};

function connectReader(connection: ConnectRepositoryHistoryReader) {
  const key = `${connection.environmentId}\0${connection.repositoryId}`;
  const replica = repositories.get(key) ?? createReplica();
  repositories.set(key, replica);
  const reader: ConnectedReader = {
    closed: false,
    connection,
    epoch: new RepositoryHistoryEpoch(),
  };
  connection.port.onmessage = (
    event: MessageEvent<RepositoryHistoryWorkerRequest>,
  ) => {
    void handleReaderMessage(reader, replica, event.data).catch(() => {
      if (!("requestId" in event.data)) return;
      const failure = { _tag: "Unavailable" as const };
      replica.failure = failure;
      replica.status = "error";
      replica.revision += 1;
      publishSnapshot(reader, replica);
      post(reader, {
        _tag: "RequestFailed",
        failure,
        requestId: event.data.requestId,
      });
    });
  };
  connection.port.start();
  publishSnapshot(reader, replica);
}

async function handleReaderMessage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: RepositoryHistoryWorkerRequest,
) {
  if (reader.closed) return;
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
      publishSnapshot(reader, replica);
      post(reader, {
        _tag: "LoadHistory",
        query: message.query,
        requestId: message.requestId,
      });
      return;
    }
    case "HistoryPageReceived":
      if (!reader.epoch.isCurrent(message.requestId)) return;
      await acceptHistoryPage(
        reader,
        replica,
        message.requestId,
        message.bytes,
      );
      return;
    case "HistoryPageFailed":
      if (!reader.epoch.finish(message.requestId)) return;
      replica.failure = message.failure;
      replica.status = "error";
      replica.revision += 1;
      publishSnapshot(reader, replica);
      post(reader, {
        _tag: "RequestFailed",
        failure: message.failure,
        requestId: message.requestId,
      });
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
      reader.closed = true;
      const activeRequestId = reader.epoch.cancel();
      if (activeRequestId !== undefined) {
        post(reader, {
          _tag: "CancelHistoryLoad",
          requestId: activeRequestId,
        });
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
    for (const commit of page.commits) replica.commits.set(commit.oid, commit);
    replica.refTargets = page.refTargets;
    replica.visibleOids = page.commits.map((commit) => commit.oid);
    delete replica.failure;
    replica.status = page.commits.length === 0 ? "empty" : "ready";
    replica.revision += 1;
    reader.epoch.finish(requestId);
    publishSnapshot(reader, replica);
    post(reader, {
      _tag: "HistoryResult",
      commits: page.commits,
      requestId,
    });
  } catch {
    reader.epoch.finish(requestId);
    const failure = { _tag: "Unavailable" as const };
    replica.failure = failure;
    replica.status = "error";
    replica.revision += 1;
    publishSnapshot(reader, replica);
    post(reader, { _tag: "RequestFailed", failure, requestId });
  }
}

function publishSnapshot(reader: ConnectedReader, replica: RepositoryReplica) {
  post(reader, {
    _tag: "SnapshotChanged",
    ...(replica.failure === undefined ? {} : { failure: replica.failure }),
    revision: replica.revision,
    status: replica.status,
  });
}

function post(
  reader: ConnectedReader,
  message: RepositoryHistoryWorkerResponse,
) {
  if (!reader.closed) reader.connection.port.postMessage(message);
}

function createReplica(): RepositoryReplica {
  return {
    commits: new Map(),
    refTargets: [],
    revision: 0,
    status: "empty",
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
  status: "empty" | "error" | "loading" | "ready";
  visibleOids: readonly string[];
}

import type {
  RepositoryCommit,
  RepositoryCommitIdentity,
  RepositoryHistoryBatch,
  RepositoryHistoryPage,
} from "@rebase/contracts/repository-history/repository-history.contract";
import { maximumRepositoryHistorySequence } from "@rebase/contracts/repository-history/repository-history-limits.contract";

const pageMagic = 0x5248_5031;
const batchMagic = 0x5248_4232;
const maximumBatchCommitCount = 512;
const maximumCommitCount = 1_000;
const maximumParentCount = 4_096;
const maximumRefCount = 256;
const maximumSnapshotRefCount = 40_512;
const maximumSnapshotRootCount = 40_512;
const maximumStringBytes = 1_048_576;

export function encodeRepositoryHistoryPage(page: RepositoryHistoryPage) {
  if (page.refTargets.length > maximumRefCount) {
    throw new Error("Too many ref targets");
  }
  if (page.commits.length > maximumCommitCount) {
    throw new Error("Too many commits");
  }
  const writer = new BinaryWriter();
  writer.uint32(pageMagic);
  writer.uint8(page.objectFormat === "sha1" ? 1 : 2);
  writer.string(page.requestId);
  writer.string(page.repositoryId);
  writer.uint16(page.refTargets.length);
  for (const target of page.refTargets) {
    writer.uint8(refTypeCode(target.type));
    writer.string(target.name);
    writeOid(writer, target.oid, page.objectFormat);
  }
  writer.uint16(page.commits.length);
  for (const commit of page.commits) {
    writeCommit(writer, commit, page.objectFormat);
  }
  return writer.bytes();
}

export function decodeRepositoryHistoryPage(bytes: Uint8Array) {
  const reader = new BinaryReader(bytes);
  if (reader.uint32() !== pageMagic) {
    throw new Error("Invalid history page");
  }
  const encodedFormat = reader.uint8();
  const objectFormat =
    encodedFormat === 1 ? "sha1" : encodedFormat === 2 ? "sha256" : undefined;
  if (objectFormat === undefined) {
    throw new Error("Invalid object format");
  }
  const requestId = reader.string();
  const repositoryId = reader.string();
  const refCount = reader.uint16();
  if (refCount > maximumRefCount) {
    throw new Error("Too many ref targets");
  }
  const refTargets = Array.from({ length: refCount }, () => {
    const type = readRefType(reader.uint8());
    return {
      name: reader.string(),
      oid: readOid(reader, objectFormat),
      type,
    };
  });
  const count = reader.uint16();
  if (count > maximumCommitCount) {
    throw new Error("Too many commits");
  }
  const commits = Array.from({ length: count }, () =>
    readCommit(reader, objectFormat),
  );
  reader.requireEnd();
  return {
    commits,
    objectFormat,
    refTargets,
    repositoryId,
    requestId,
  } satisfies RepositoryHistoryPage;
}

export function encodeRepositoryHistoryBatch(batch: RepositoryHistoryBatch) {
  if (batch.commits.length > maximumBatchCommitCount) {
    throw new Error("Too many commits in history batch");
  }
  const writer = new BinaryWriter();
  writer.uint32(batchMagic);
  writer.uint8(batch.objectFormat === "sha1" ? 1 : 2);
  writer.string(batch.requestId);
  writer.string(batch.repositoryId);
  writer.uint32(batch.sequence);
  writer.uint8(batch.snapshot === undefined ? 0 : 1);
  if (batch.snapshot !== undefined) {
    writeSnapshot(writer, batch.snapshot, batch.objectFormat);
  }
  writer.uint16(batch.commits.length);
  for (const commit of batch.commits) {
    writeCommit(writer, commit, batch.objectFormat);
  }
  return writer.bytes();
}

export function decodeRepositoryHistoryBatch(
  bytes: Uint8Array,
): RepositoryHistoryBatch {
  const reader = new BinaryReader(bytes);
  if (reader.uint32() !== batchMagic) {
    throw new Error("Invalid history batch");
  }
  const encodedFormat = reader.uint8();
  const objectFormat =
    encodedFormat === 1 ? "sha1" : encodedFormat === 2 ? "sha256" : undefined;
  if (objectFormat === undefined) {
    throw new Error("Invalid object format");
  }
  const requestId = reader.string();
  const repositoryId = reader.string();
  const sequence = reader.uint32();
  const hasSnapshot = reader.uint8();
  if (hasSnapshot !== 0 && hasSnapshot !== 1) {
    throw new Error("Invalid history snapshot flag");
  }
  const snapshot =
    hasSnapshot === 1 ? readSnapshot(reader, objectFormat) : undefined;
  const count = reader.uint16();
  if (count > maximumBatchCommitCount) {
    throw new Error("Too many commits in history batch");
  }
  const commits = Array.from({ length: count }, () =>
    readCommit(reader, objectFormat),
  );
  reader.requireEnd();
  return {
    commits,
    objectFormat,
    repositoryId,
    requestId,
    sequence,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
}

export function readRepositoryHistoryBatchSequence(bytes: Uint8Array) {
  const reader = new BinaryReader(bytes);
  if (reader.uint32() !== batchMagic) {
    throw new Error("Invalid history batch");
  }
  const encodedFormat = reader.uint8();
  if (encodedFormat !== 1 && encodedFormat !== 2) {
    throw new Error("Invalid object format");
  }
  reader.string();
  reader.string();
  return reader.uint32();
}

function writeSnapshot(
  writer: BinaryWriter,
  snapshot: NonNullable<RepositoryHistoryBatch["snapshot"]>,
  objectFormat: RepositoryHistoryBatch["objectFormat"],
) {
  if (snapshot.objectFormat !== objectFormat) {
    throw new Error("History snapshot object format does not match the batch");
  }
  if (!/^[0-9a-f]{64}$/.test(snapshot.id)) {
    throw new Error("Invalid history snapshot ID");
  }
  if (snapshot.refTargets.length > maximumSnapshotRefCount) {
    throw new Error("Too many history snapshot refs");
  }
  if (snapshot.rootOids.length > maximumSnapshotRootCount) {
    throw new Error("Too many history snapshot roots");
  }
  writer.string(snapshot.id);
  writer.uint8(snapshot.resumable ? 1 : 0);
  writer.uint32(snapshot.refTargets.length);
  for (const target of snapshot.refTargets) {
    writer.uint8(refTypeCode(target.type));
    writer.string(target.name);
    writeOid(writer, target.oid, objectFormat);
  }
  writer.uint32(snapshot.rootOids.length);
  for (const oid of snapshot.rootOids) {
    writeOid(writer, oid, objectFormat);
  }
  if (
    snapshot.shallowOids !== undefined &&
    snapshot.shallowOids.length > maximumSnapshotRootCount
  )
    throw new Error("Too many shallow history boundaries");
  writer.uint32(snapshot.shallowOids?.length ?? 0xffff_ffff);
  for (const oid of snapshot.shallowOids ?? [])
    writeOid(writer, oid, objectFormat);
}

function readSnapshot(
  reader: BinaryReader,
  objectFormat: RepositoryHistoryBatch["objectFormat"],
): NonNullable<RepositoryHistoryBatch["snapshot"]> {
  const id = reader.string();
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw new Error("Invalid history snapshot ID");
  }
  const resumable = reader.uint8();
  if (resumable !== 0 && resumable !== 1) {
    throw new Error("Invalid resumable snapshot flag");
  }
  const refCount = reader.uint32();
  if (refCount > maximumSnapshotRefCount) {
    throw new Error("Too many history snapshot refs");
  }
  const refTargets = Array.from({ length: refCount }, () => {
    const type = readRefType(reader.uint8());
    return {
      name: reader.string(),
      oid: readOid(reader, objectFormat),
      type,
    };
  });
  const rootCount = reader.uint32();
  if (rootCount > maximumSnapshotRootCount) {
    throw new Error("Too many history snapshot roots");
  }
  const rootOids = Array.from({ length: rootCount }, () =>
    readOid(reader, objectFormat),
  );
  const shallowCount = reader.uint32();
  if (shallowCount !== 0xffff_ffff && shallowCount > maximumSnapshotRootCount)
    throw new Error("Too many shallow history boundaries");
  const shallowOids =
    shallowCount === 0xffff_ffff
      ? undefined
      : Array.from({ length: shallowCount }, () =>
          readOid(reader, objectFormat),
        );
  return {
    id,
    objectFormat,
    refTargets,
    resumable: resumable === 1,
    rootOids,
    ...(shallowOids === undefined ? {} : { shallowOids }),
  };
}

function writeCommit(
  writer: BinaryWriter,
  commit: RepositoryCommit,
  objectFormat: RepositoryHistoryPage["objectFormat"],
) {
  writeOid(writer, commit.oid, objectFormat);
  if (commit.parents.length > maximumParentCount) {
    throw new Error("Too many parents");
  }
  writer.uint16(commit.parents.length);
  for (const parent of commit.parents) {
    writeOid(writer, parent, objectFormat);
  }
  writeIdentity(writer, commit.author);
  writeIdentity(writer, commit.committer);
  writer.string(commit.subject);
}

function readCommit(
  reader: BinaryReader,
  objectFormat: RepositoryHistoryPage["objectFormat"],
): RepositoryCommit {
  const oid = readOid(reader, objectFormat);
  const parentCount = reader.uint16();
  if (parentCount > maximumParentCount) {
    throw new Error("Too many parents");
  }
  const parents = Array.from({ length: parentCount }, () =>
    readOid(reader, objectFormat),
  );
  return {
    author: readIdentity(reader),
    committer: readIdentity(reader),
    oid,
    parents,
    subject: reader.string(),
  };
}

function writeIdentity(
  writer: BinaryWriter,
  identity: RepositoryCommitIdentity,
) {
  writer.string(identity.name);
  writer.string(identity.email);
  writer.int64(identity.timestampSeconds);
  writer.int16(identity.timezoneOffsetMinutes);
}

function readIdentity(reader: BinaryReader): RepositoryCommitIdentity {
  const name = reader.string();
  const email = reader.string();
  return {
    email,
    name,
    timestampSeconds: reader.int64(),
    timezoneOffsetMinutes: reader.int16(),
  };
}

function readOid(
  reader: BinaryReader,
  objectFormat: RepositoryHistoryPage["objectFormat"],
) {
  const oid = reader.string();
  const length = objectFormat === "sha1" ? 40 : 64;
  if (oid.length !== length || !/^[0-9a-f]+$/.test(oid)) {
    throw new Error("Invalid object ID");
  }
  return oid;
}

function writeOid(
  writer: BinaryWriter,
  oid: string,
  objectFormat: RepositoryHistoryPage["objectFormat"],
) {
  const length = objectFormat === "sha1" ? 40 : 64;
  if (oid.length !== length || !/^[0-9a-f]+$/.test(oid)) {
    throw new Error("Invalid object ID");
  }
  writer.string(oid);
}

function refTypeCode(
  type: RepositoryHistoryPage["refTargets"][number]["type"],
) {
  switch (type) {
    case "branch":
      return 1;
    case "head":
      return 2;
    case "remote-branch":
      return 3;
    case "tag":
      return 4;
  }
}

function readRefType(code: number) {
  switch (code) {
    case 1:
      return "branch" as const;
    case 2:
      return "head" as const;
    case 3:
      return "remote-branch" as const;
    case 4:
      return "tag" as const;
    default:
      throw new Error("Invalid ref target type");
  }
}

class BinaryWriter {
  readonly #chunks: Uint8Array[] = [];
  #length = 0;

  bytes() {
    const output = new Uint8Array(this.#length);
    let offset = 0;
    for (const chunk of this.#chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  int16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setInt16(0, value, false);
    this.write(bytes);
  }

  int64(value: number) {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Invalid timestamp");
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, BigInt(value), false);
    this.write(bytes);
  }

  string(value: string) {
    const encoded = new TextEncoder().encode(value);
    if (encoded.byteLength > maximumStringBytes) {
      throw new Error("String is too large");
    }
    this.uint32(encoded.byteLength);
    this.write(encoded);
  }

  uint8(value: number) {
    this.write(Uint8Array.of(value));
  }

  uint16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, false);
    this.write(bytes);
  }

  uint32(value: number) {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > maximumRepositoryHistorySequence
    ) {
      throw new Error("Invalid unsigned 32-bit integer");
    }
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    this.write(bytes);
  }

  private write(bytes: Uint8Array) {
    this.#chunks.push(bytes);
    this.#length += bytes.byteLength;
  }
}

class BinaryReader {
  readonly #input: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  constructor(input: Uint8Array) {
    this.#input = input;
    this.#view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  }

  int16() {
    this.require(2);
    const value = this.#view.getInt16(this.#offset, false);
    this.#offset += 2;
    return value;
  }

  int64() {
    this.require(8);
    const value = this.#view.getBigInt64(this.#offset, false);
    this.#offset += 8;
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      throw new Error("Invalid timestamp");
    }
    return number;
  }

  requireEnd() {
    if (this.#offset !== this.#input.byteLength) {
      throw new Error("Unexpected trailing bytes");
    }
  }

  string() {
    const length = this.uint32();
    if (length > maximumStringBytes) {
      throw new Error("String is too large");
    }
    this.require(length);
    const value = new TextDecoder("utf-8", { fatal: true }).decode(
      this.#input.subarray(this.#offset, this.#offset + length),
    );
    this.#offset += length;
    return value;
  }

  uint8() {
    this.require(1);
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  uint16() {
    this.require(2);
    const value = this.#view.getUint16(this.#offset, false);
    this.#offset += 2;
    return value;
  }

  uint32() {
    this.require(4);
    const value = this.#view.getUint32(this.#offset, false);
    this.#offset += 4;
    return value;
  }

  private require(length: number) {
    if (this.#offset + length > this.#input.byteLength) {
      throw new Error("Truncated binary data");
    }
  }
}

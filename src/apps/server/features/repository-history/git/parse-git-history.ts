import type {
  RepositoryCommit,
  RepositoryCommitIdentity,
} from "@rebase/contracts";
import {
  type GitObjectFormat,
  isGitObjectId,
} from "#server/domain/git-object-id";

export const gitHistoryFormat = [
  "%H",
  "%P",
  "%an",
  "%ae",
  "%at",
  "%aI",
  "%cn",
  "%ce",
  "%ct",
  "%cI",
  "%s",
].join("%x00");

const fieldsPerCommit = 11;

export function createGitHistoryBatchParser(
  objectFormat: GitObjectFormat,
  batchSize: number,
  maximumBatchCharacters = Number.POSITIVE_INFINITY,
) {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    maximumBatchCharacters < 1
  ) {
    throw new Error("Invalid history batch size");
  }
  let remainder = "";
  let fields: string[] = [];
  let commits: RepositoryCommit[] = [];
  let batchCharacters = 0;

  const flush = (batches: RepositoryCommit[][]) => {
    if (commits.length === 0) {
      return;
    }
    batches.push(commits);
    commits = [];
    batchCharacters = 0;
  };

  const acceptField = (field: string, batches: RepositoryCommit[][]) => {
    fields.push(field);
    if (fields.length !== fieldsPerCommit) {
      return;
    }
    const commit = parseCommit(fields, objectFormat);
    fields = [];
    const characters = commitCharacters(commit);
    if (
      commits.length > 0 &&
      batchCharacters + characters > maximumBatchCharacters
    ) {
      flush(batches);
    }
    commits.push(commit);
    batchCharacters += characters;
    if (commits.length === batchSize) {
      flush(batches);
    }
  };

  return {
    accept(chunk: string): readonly (readonly RepositoryCommit[])[] {
      const batches: RepositoryCommit[][] = [];
      remainder += chunk;
      let start = 0;
      let separator = remainder.indexOf("\0");
      while (separator >= 0) {
        acceptField(remainder.slice(start, separator), batches);
        start = separator + 1;
        separator = remainder.indexOf("\0", start);
      }
      remainder = remainder.slice(start);
      return batches;
    },
    finish(): readonly (readonly RepositoryCommit[])[] {
      if (remainder.length > 0 || fields.length > 0) {
        throw new Error("Truncated Git history record");
      }
      const batches: RepositoryCommit[][] = [];
      flush(batches);
      return batches;
    },
  };
}

function commitCharacters(commit: RepositoryCommit) {
  return (
    commit.oid.length +
    commit.parents.reduce((total, parent) => total + parent.length, 0) +
    commit.author.name.length +
    commit.author.email.length +
    commit.committer.name.length +
    commit.committer.email.length +
    commit.subject.length
  );
}

export function parseGitHistory(
  output: string,
  objectFormat: GitObjectFormat,
): readonly RepositoryCommit[] {
  if (output.length === 0) {
    return [];
  }
  const fields = output.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length % fieldsPerCommit !== 0) {
    throw new Error("Truncated Git history record");
  }
  const commits: RepositoryCommit[] = [];
  for (let offset = 0; offset < fields.length; offset += fieldsPerCommit) {
    commits.push(
      parseCommit(fields.slice(offset, offset + fieldsPerCommit), objectFormat),
    );
  }
  return commits;
}

function parseCommit(
  fields: readonly string[],
  objectFormat: GitObjectFormat,
): RepositoryCommit {
  const [
    oid,
    parentField,
    authorName,
    authorEmail,
    authorTimestamp,
    authorIsoDate,
    committerName,
    committerEmail,
    committerTimestamp,
    committerIsoDate,
    subject,
  ] = fields;
  if (
    oid === undefined ||
    parentField === undefined ||
    authorName === undefined ||
    authorEmail === undefined ||
    authorTimestamp === undefined ||
    authorIsoDate === undefined ||
    committerName === undefined ||
    committerEmail === undefined ||
    committerTimestamp === undefined ||
    committerIsoDate === undefined ||
    subject === undefined
  ) {
    throw new Error("Truncated Git history record");
  }
  const parents = parentField.length === 0 ? [] : parentField.split(" ");
  requireOid(oid, objectFormat);
  for (const parent of parents) {
    requireOid(parent, objectFormat);
  }
  return {
    author: parseIdentity(
      authorName,
      authorEmail,
      authorTimestamp,
      authorIsoDate,
    ),
    committer: parseIdentity(
      committerName,
      committerEmail,
      committerTimestamp,
      committerIsoDate,
    ),
    oid,
    parents,
    subject,
  };
}

function parseIdentity(
  name: string,
  email: string,
  encodedTimestamp: string,
  isoDate: string,
): RepositoryCommitIdentity {
  const timestampSeconds = Number(encodedTimestamp);
  if (!Number.isSafeInteger(timestampSeconds)) {
    throw new Error("Invalid Git timestamp");
  }
  const timezoneOffsetMinutes = parseTimezoneOffset(isoDate);
  return { email, name, timestampSeconds, timezoneOffsetMinutes };
}

function parseTimezoneOffset(isoDate: string) {
  if (isoDate.endsWith("Z")) {
    return 0;
  }
  const timezone = /([+-])(\d{2}):(\d{2})$/.exec(isoDate);
  if (
    timezone?.[1] === undefined ||
    timezone[2] === undefined ||
    timezone[3] === undefined
  ) {
    throw new Error("Invalid Git timezone");
  }
  const absoluteMinutes = Number(timezone[2]) * 60 + Number(timezone[3]);
  return timezone[1] === "-" ? -absoluteMinutes : absoluteMinutes;
}

function requireOid(oid: string, objectFormat: GitObjectFormat) {
  if (!isGitObjectId(oid, objectFormat)) {
    throw new Error("Invalid Git object ID");
  }
}

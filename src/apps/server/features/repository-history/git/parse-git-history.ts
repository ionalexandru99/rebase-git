import type {
  RepositoryCommit,
  RepositoryCommitIdentity,
} from "@rebase/contracts";

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

export function parseGitHistory(
  output: string,
  objectFormat: "sha1" | "sha256",
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
  objectFormat: "sha1" | "sha256",
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

function requireOid(oid: string, objectFormat: "sha1" | "sha256") {
  const expectedLength = objectFormat === "sha1" ? 40 : 64;
  if (oid.length !== expectedLength || !/^[0-9a-f]+$/.test(oid)) {
    throw new Error("Invalid Git object ID");
  }
}

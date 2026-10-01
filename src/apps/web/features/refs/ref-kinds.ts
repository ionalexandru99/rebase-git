import type { RouteFailure } from "#contracts/environment-connection/environment-route.contract.ts";
import type {
  BranchUpstreamTarget,
  RepositoryBranchesApi,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import type {
  RepositoryTagsApi,
  TagRejected,
} from "#contracts/repository-refs/repository-tags.contract.ts";
import {
  describeFailure,
  type FailureMessages,
  rejection,
} from "#web/platform/query/request-failure.ts";
import type { CommandFailure } from "#web/platform/query/use-command.ts";

export type RefKind = "branch" | "tag";

export const refKinds = {
  branch: {
    noun: "branch",
    plural: "branches",
    draftLabel: (at: string) => `New branch from ${at}`,
  },
  tag: {
    noun: "tag",
    plural: "tags",
    draftLabel: (at: string) => `New tag at ${at}`,
  },
} as const satisfies Record<RefKind, unknown>;

export interface StartPoint {
  readonly label: string;
  readonly name: string;
  readonly oid: string;
  readonly track?: BranchUpstreamTarget;
}

export type RefRoute =
  | (typeof RepositoryBranchesApi)[keyof typeof RepositoryBranchesApi]
  | (typeof RepositoryTagsApi)[keyof typeof RepositoryTagsApi];

export function commitStartPoint(oid: string): StartPoint {
  return { label: oid.slice(0, 7), name: "", oid };
}

export function refNameProblem(
  kind: RefKind,
  name: string,
  existing: readonly { readonly name: string }[],
  current?: string,
): string | undefined {
  const { noun, plural } = refKinds[kind];
  if (name.length === 0) return `Enter a ${noun} name.`;
  if (!isValidRefName(name)) return `${name} is not a valid ${noun} name.`;
  for (const { name: other } of existing) {
    if (other === current) continue;
    if (other === name) return `${name} already exists.`;
    if (name.startsWith(`${other}/`))
      return `${other} is a ${noun}, not a folder.`;
    if (other.startsWith(`${name}/`))
      return `${name} is a folder of ${plural}.`;
  }
  return undefined;
}

function isValidRefName(name: string) {
  if (name === "HEAD" || name === "@" || name.startsWith("-")) return false;
  if ([...name].some(isControlOrSpace)) return false;
  if (/[~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$/.test(name)) return false;
  return name
    .split("/")
    .every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

function isControlOrSpace(character: string) {
  const code = character.charCodeAt(0);
  return code <= 0x20 || code === 0x7f;
}

export function namingFailure(name: string, failure: CommandFailure<RefRoute>) {
  const rejected = rejection(failure);
  const naming =
    rejected?._tag === "InvalidBranchName" ||
    rejected?._tag === "BranchExists" ||
    (rejected?._tag === "TagRejected" && namingReasons.has(rejected.reason));
  return naming
    ? describeFailure(failure, refFailureMessages(name))
    : undefined;
}

const namingReasons = new Set<TagRejected["reason"]>([
  "Exists",
  "InvalidName",
  "MessageRequired",
]);

export function refFailureMessages(
  name: string,
): FailureMessages<RouteFailure<RefRoute>> {
  return {
    InvalidBranchName: ({ name }) => `${name} is not a valid branch name.`,
    BranchExists: ({ name }) => `${name} already exists.`,
    BranchMoved: ({ name }) => `${name} changed since it was shown. Try again.`,
    BranchNotMerged: ({ count, name }) =>
      `${count} commits exist only on ${name}.`,
    TagRejected: ({ reason }) => tagRejection(name, reason),
  };
}

function tagRejection(name: string, reason: TagRejected["reason"]) {
  switch (reason) {
    case "Exists":
      return `${name} already exists.`;
    case "InvalidName":
      return `${name} is not a valid tag name.`;
    case "MessageRequired":
      return "Your Git settings sign every tag. Add a message.";
    case "Moved":
      return `${name} changed since it was shown. Try again.`;
    case "RemoteDiffers":
      return `The remote's ${name} is missing or is not the tag you have. Nothing was deleted.`;
  }
}

import type {
  BranchUpstreamTarget,
  RepositoryBranchesApi,
  RepositoryTagsApi,
} from "@rebase/contracts";
import { describeFailure } from "#web/platform/query/request-failure";
import type { CommandFailure } from "#web/platform/query/use-command";

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

export function describeRefFailure(
  name: string,
  failure: CommandFailure<RefRoute>,
) {
  return describeFailure(failure, {
    InvalidBranchName: ({ name }) => `${name} is not a valid branch name.`,
    BranchExists: ({ name }) => `${name} already exists.`,
    BranchMoved: ({ name }) => `${name} changed since it was shown. Try again.`,
    BranchNotMerged: ({ count, name }) =>
      `${count} commits exist only on ${name}.`,
    TagRejected: ({ reason }) =>
      reason === "Exists"
        ? `${name} already exists.`
        : `${name} is not a valid tag name.`,
  });
}

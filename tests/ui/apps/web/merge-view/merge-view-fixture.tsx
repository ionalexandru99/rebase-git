import {
  type ConflictDocument,
  type ConflictFailure,
  type ConflictList,
  type ConflictRegion,
  type ConflictSides,
  RepositoryConflictsHttpApi,
  type StageConflict,
  type WriteConflict,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
import { vi } from "vite-plus/test";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import { fakeRequests, respond } from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { MergeView } from "#web/features/merge-view/merge-view";
import { RepositoryScopeProvider } from "#web/features/repository-scope/repository-scope-provider";

export const path = "src/checkout/config.ts";

const currentCommit = "8879921".padEnd(40, "a");
const incomingCommit = "940c648".padEnd(40, "b");

export const sides: ConflictSides = {
  base: { ref: null, commit: "1111111".padEnd(40, "c"), subject: "Add config" },
  current: {
    ref: "HEAD",
    commit: currentCommit,
    subject: "Move retries into config",
  },
  incoming: {
    ref: null,
    commit: incomingCommit,
    subject: "Increase checkout timeout",
  },
};

export const firstRegion: ConflictRegion = {
  id: "region-one",
  line: 4,
  current: ["  retries: 3,", "  delay: 100,"],
  base: ["  retries: 1,"],
  incoming: ["  retries: 5,"],
  blame: {
    current: { commit: currentCommit, subject: "Move retries into config" },
    incoming: { commit: incomingCommit, subject: "Increase checkout timeout" },
  },
  marks: {
    current: [{ line: 0, start: 11, end: 12 }],
    incoming: [{ line: 0, start: 11, end: 12 }],
  },
  open: true,
};

export const secondRegion: ConflictRegion = {
  id: "region-two",
  line: 13,
  current: ["  return 1;"],
  base: ["  return 0;"],
  incoming: ["  return 2;"],
  blame: { current: null, incoming: null },
  marks: {
    current: [{ line: 0, start: 9, end: 10 }],
    incoming: [{ line: 0, start: 9, end: 10 }],
  },
  open: true,
};

export const firstMarker = [
  "<<<<<<< HEAD",
  "  retries: 3,",
  "  delay: 100,",
  "=======",
  "  retries: 5,",
  ">>>>>>> 940c648 (Increase checkout timeout)",
];

export const secondMarker = [
  "<<<<<<< HEAD",
  "  return 1;",
  "=======",
  "  return 2;",
  ">>>>>>> 940c648 (Increase checkout timeout)",
];

export const head = [
  'import { base } from "./base";',
  "",
  "export const checkout = {",
];
export const middle = ["};", "", "export function weight() {"];
export const tail = ["}", ""];

export function content(
  first: readonly string[] = firstMarker,
  second: readonly string[] = secondMarker,
) {
  return [...head, ...first, ...middle, ...second, ...tail].join("\n");
}

export const initialContent = content();

function conflictFailure(reason: ConflictFailure["reason"]) {
  return new EnvironmentHttpRejected({
    failure: {
      _tag: "ConflictFailed",
      reason,
      detail: `Rejected: ${reason}`,
    } satisfies ConflictFailure,
  });
}

interface FixtureOptions {
  readonly documentFailure?: ConflictFailure["reason"];
  readonly otherFiles?: ConflictList["files"];
  readonly mergeTool?: string | null;
}

export async function mergeViewFixture({
  documentFailure,
  otherFiles = [],
  mergeTool = null,
}: FixtureOptions = {}) {
  let text = initialContent;
  let revision = "revision-0";
  let reads = 0;
  let staleNext = false;
  let heldWrites: Promise<void> | undefined;
  let releaseWrites = () => {};
  const writes: WriteConflict[] = [];
  const stages: StageConflict[] = [];
  const onOpen = vi.fn();
  const onClose = vi.fn();

  const file = (): ConflictList["files"][number] => ({
    path,
    revision,
    kind: "both-modified",
    stages: [],
    openRegions: openRegions().length,
    choices: ["current", "incoming", "worktree"],
  });
  const openRegions = () =>
    [
      { region: firstRegion, marker: firstMarker },
      { region: secondRegion, marker: secondMarker },
    ].filter(({ marker }) => text.includes(marker.join("\n")));
  const document = (): ConflictDocument => ({
    file: file(),
    sides,
    content: text,
    regions: [firstRegion, secondRegion].map((region) => ({
      ...region,
      open: openRegions().some((open) => open.region.id === region.id),
    })),
  });
  const list = (files: ConflictList["files"]): ConflictList => ({
    operation: "rebase",
    sides,
    files,
    resolved: [],
    mergeTool,
  });

  const requests = fakeRequests(
    respond(RepositoryConflictsHttpApi.document, () => {
      reads += 1;
      if (documentFailure !== undefined) throw conflictFailure(documentFailure);
      return document();
    }),
    respond(RepositoryConflictsHttpApi.list, () =>
      list([file(), ...otherFiles]),
    ),
    respond(RepositoryConflictsHttpApi.write, async (command) => {
      writes.push(command);
      await heldWrites;
      if (staleNext) {
        staleNext = false;
        text = content(["// changed on disk"], secondMarker);
        revision = "revision-disk";
        throw conflictFailure("Stale");
      }
      if (command.revision !== revision) throw conflictFailure("Stale");
      text = command.content;
      revision = `revision-${writes.length}`;
      return document();
    }),
    respond(RepositoryConflictsHttpApi.stage, (command) => {
      stages.push(command);
      if (!command.allowMarkers && openRegions().length > 0)
        throw conflictFailure("Markers");
      return list(otherFiles);
    }),
    respond(RepositoryConflictsHttpApi.choose, () => list(otherFiles)),
  );

  const view = await render(
    <RepositoryScopeProvider scope={repositoryScope()}>
      <MergeView path={path} onOpen={onOpen} onClose={onClose} />
    </RepositoryScopeProvider>,
    { environment: { requests } },
  );

  return {
    view,
    writes,
    stages,
    onOpen,
    onClose,
    reads: () => reads,
    text: () => text,
    staleOnNextWrite: () => {
      staleNext = true;
    },
    holdWrites: () => {
      heldWrites = new Promise((resolve) => {
        releaseWrites = resolve;
      });
    },
    releaseWrites: () => {
      heldWrites = undefined;
      releaseWrites();
    },
  };
}

import {
  type ConflictDocument,
  type ConflictFailure,
  type ConflictList,
  type ConflictRegion,
  type ConflictSides,
  RepositoryConflictsApi,
  type StageConflict,
  type WriteConflict,
} from "@rebase/contracts";
import { vi } from "vite-plus/test";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { MergeView } from "#web/features/merge-view/merge-view";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope";

export const path = "src/checkout/config.ts";

const sides: ConflictSides = {
  base: { ref: null, commit: "1111111".padEnd(40, "c"), subject: "Add config" },
  current: {
    ref: "HEAD",
    commit: "8879921".padEnd(40, "a"),
    subject: "Move retries into config",
  },
  incoming: {
    ref: null,
    commit: "940c648".padEnd(40, "b"),
    subject: "Increase checkout timeout",
  },
};

const firstRegion = {
  id: "region-one",
  current: ["  retries: 3,", "  delay: 100,"],
  base: ["  retries: 1,"],
  incoming: ["  retries: 5,"],
  marks: {
    current: [{ line: 0, start: 11, end: 12 }],
    incoming: [{ line: 0, start: 11, end: 12 }],
  },
};

const secondRegion = {
  id: "region-two",
  current: ["  return 1;"],
  base: ["  return 0;"],
  incoming: ["  return 2;"],
  marks: {
    current: [{ line: 0, start: 9, end: 10 }],
    incoming: [{ line: 0, start: 9, end: 10 }],
  },
};

export const firstMarker = [
  "<<<<<<< HEAD",
  "  retries: 3,",
  "  delay: 100,",
  "=======",
  "  retries: 5,",
  ">>>>>>> 940c648 (Increase checkout timeout)",
];

const secondMarker = [
  "<<<<<<< HEAD",
  "  return 1;",
  "=======",
  "  return 2;",
  ">>>>>>> 940c648 (Increase checkout timeout)",
];

const head = [
  'import { base } from "./base";',
  "",
  "export const checkout = {",
];
const middle = ["};", "", "export function weight() {"];
const tail = ["}", ""];

export function content(
  first: readonly string[] = firstMarker,
  second: readonly string[] = secondMarker,
) {
  return [...head, ...first, ...middle, ...second, ...tail].join("\n");
}

export const initialContent = content();

function conflictFailure(reason: ConflictFailure["reason"]) {
  return rejected({
    _tag: "ConflictFailed",
    reason,
    detail: `Rejected: ${reason}`,
  } satisfies ConflictFailure);
}

interface FixtureOptions {
  readonly documentFailure?: ConflictFailure["reason"];
  readonly otherFiles?: readonly {
    readonly path: string;
    readonly openRegions: number;
  }[];
}

export async function mergeViewFixture({
  documentFailure,
  otherFiles = [],
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
    openRegions: regions().filter(({ open }) => open).length,
    choices: ["current", "incoming"],
  });
  const regions = () =>
    [
      { region: firstRegion, marker: firstMarker },
      { region: secondRegion, marker: secondMarker },
    ].map(({ region, marker }): ConflictRegion => {
      const at = text.indexOf(marker.join("\n"));
      const line = at === -1 ? null : text.slice(0, at).split("\n").length;
      return { ...region, line, open: line !== null };
    });
  const others: ConflictList["files"] = otherFiles.map(
    ({ path, openRegions }) => ({
      path,
      revision: path,
      kind: "both-modified",
      stages: [],
      openRegions,
      choices: [],
    }),
  );
  const document = (): ConflictDocument => ({
    file: file(),
    content: text,
    regions: regions(),
  });
  const list = (files: ConflictList["files"]): ConflictList => ({
    sides,
    files,
  });

  const requests = fakeRequests(
    respond(RepositoryConflictsApi.document, () => {
      reads += 1;
      if (documentFailure !== undefined) throw conflictFailure(documentFailure);
      return document();
    }),
    respond(RepositoryConflictsApi.list, () => list([file(), ...others])),
    respond(RepositoryConflictsApi.write, async (command) => {
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
    respond(RepositoryConflictsApi.stage, (command) => {
      stages.push(command);
      if (!command.allowMarkers && file().openRegions > 0)
        throw conflictFailure("Markers");
      return list(others);
    }),
    respond(RepositoryConflictsApi.choose, () => list(others)),
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

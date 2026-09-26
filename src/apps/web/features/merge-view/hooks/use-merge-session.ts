import type {
  ConflictDocument,
  ConflictList,
  ConflictPath,
  ConflictSide,
} from "@rebase/contracts";
import { useCallback, useEffect, useState } from "react";
import { useConflictQueries } from "#web/features/merge-view/hooks/use-conflict-queries";
import { useResolution } from "#web/features/merge-view/hooks/use-resolution";
import { useWriteQueue } from "#web/features/merge-view/hooks/use-write-queue";
import { editText } from "#web/features/merge-view/merge-edit";
import {
  choicePicks,
  choosePicks,
  chooseSide,
  fileContent,
  type LinePick,
  type MergeModel,
  mergeModel,
  regionSegments,
  restoreRegion,
} from "#web/features/merge-view/merge-model";
import {
  type ConflictRequestFailure,
  describeConflictFailure,
  staleNotice,
} from "#web/features/merge-view/merge-view-messages";

export interface MergeSessionOptions {
  readonly input: ConflictPath;
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
}

export function useMergeSession({
  input,
  onOpen,
  onClose,
}: MergeSessionOptions) {
  const queries = useConflictQueries(input);
  const [model, setModel] = useState<MergeModel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const fail = (failure: ConflictRequestFailure) =>
    setNotice(describeConflictFailure(failure));
  const queue = useWriteQueue(input, {
    onWritten: (document) => {
      queries.storeDocument(document);
      void queries.refreshList();
    },
    onStale: () => stale(),
    onFailed: fail,
  });
  const load = useCallback(
    (document: ConflictDocument) => {
      queue.acknowledge(document.file.revision, document.content);
      setModel(mergeModel(document));
    },
    [queue],
  );
  const refetchDocument = queries.document.refetch;
  const reload = useCallback(async () => {
    const { data } = await refetchDocument();
    if (data !== undefined) load(data);
  }, [load, refetchDocument]);
  const stale = () => {
    setNotice(staleNotice(input.path));
    void reload();
  };
  useDocumentLoading(queries.document.data, queue, load);
  useEffect(() => {
    if (model !== null) queue.enqueue(fileContent(model));
  }, [model, queue]);

  const change = useCallback((update: (model: MergeModel) => MergeModel) => {
    setNotice(null);
    setModel((current) => (current === null ? current : update(current)));
  }, []);
  const choose = useCallback(
    (
      regionId: string,
      update: (picks: readonly LinePick[]) => readonly LinePick[],
    ) =>
      change((current) =>
        choosePicks(current, regionId, update(regionPicks(current, regionId))),
      ),
    [change],
  );
  const regions = model === null ? [] : regionSegments(model);
  const activeRegion =
    regions.find(({ region }) => region.id === selectedRegion)?.region.id ??
    regions.find(({ choice }) => choice.kind === "open")?.region.id ??
    regions[0]?.region.id ??
    null;

  const resolution = useResolution({
    input,
    queue,
    listedRevision: queries.list.data?.files.find(
      ({ path }) => path === input.path,
    )?.revision,
    onList: queries.storeList,
    onResolved: (list: ConflictList) => {
      const next = list.files.find(
        ({ path, openRegions }) => path !== input.path && openRegions > 0,
      );
      if (next === undefined) onClose();
      else onOpen(next.path);
    },
    onReload: () => void reload(),
    onStale: stale,
    onFailed: fail,
  });

  return {
    queries,
    model,
    notice,
    activeRegion,
    selectRegion: setSelectedRegion,
    resolution,
    edit: (text: string, caret: number) =>
      change((current) => editText(current, text, caret)),
    choose,
    selectSide: (side: ConflictSide) => {
      if (activeRegion !== null)
        change((current) => chooseSide(current, activeRegion, side));
    },
    undo: (regionId: string) =>
      change((current) => restoreRegion(current, regionId)),
  };
}

export type MergeSession = ReturnType<typeof useMergeSession>;

function useDocumentLoading(
  document: ConflictDocument | undefined,
  queue: ReturnType<typeof useWriteQueue>,
  load: (document: ConflictDocument) => void,
) {
  useEffect(() => {
    if (
      document === undefined ||
      !queue.idle() ||
      document.file.revision === queue.revision()
    )
      return;
    load(document);
  }, [document, load, queue]);
}

function regionPicks(model: MergeModel, regionId: string) {
  const segment = regionSegments(model).find(
    ({ region }) => region.id === regionId,
  );
  return segment === undefined ? [] : choicePicks(segment.choice);
}

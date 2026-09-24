import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RepositoryHistorySearch } from "#web/domain/repository-history/history-search.contract";
import { createRepositoryHistorySearchModel } from "#web/features/history-search/repository-history-search-model";
import { useApplicationRuntime } from "#web-ui/platform/effect/application-runtime-context";

export function useRepositoryHistorySearchModel(
  reader: RepositoryHistorySearch,
  revision: number,
  onNavigate: (oid: string, signal: AbortSignal) => Promise<void>,
) {
  const runtime = useApplicationRuntime();
  const navigate = useRef(onNavigate);
  const text = useRef("");
  const contentRevision = useRef(revision);
  useLayoutEffect(() => {
    navigate.current = onNavigate;
    contentRevision.current = revision;
  }, [onNavigate, revision]);
  const [owner, setOwner] = useState<{
    readonly reader: RepositoryHistorySearch;
    readonly model: ReturnType<typeof createRepositoryHistorySearchModel>;
  }>();
  useEffect(() => {
    const model = createRepositoryHistorySearchModel(
      reader,
      (oid, signal) => navigate.current(oid, signal),
      runtime,
    );
    model.refresh(contentRevision.current);
    model.setText(text.current);
    setOwner({ reader, model });
    return () => {
      text.current = model.getSnapshot().text;
      void model.dispose();
    };
  }, [reader, runtime]);
  const model = owner?.reader === reader ? owner.model : undefined;
  useEffect(() => {
    model?.refresh(revision);
  }, [model, revision]);
  return model;
}

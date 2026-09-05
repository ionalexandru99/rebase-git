import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RepositoryHistorySearch } from "#web/features/repository-history/search/repository-history-search.contract";
import { createRepositoryHistorySearchModel } from "#web/features/repository-history/search/repository-history-search-model";

export function useRepositoryHistorySearchModel(
  reader: RepositoryHistorySearch,
  revision: number,
  onNavigate: (oid: string, signal: AbortSignal) => Promise<void>,
) {
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
    const model = createRepositoryHistorySearchModel(reader, (oid, signal) =>
      navigate.current(oid, signal),
    );
    model.refresh(contentRevision.current);
    model.setText(text.current);
    setOwner({ reader, model });
    return () => {
      text.current = model.getSnapshot().text;
      void model.dispose();
    };
  }, [reader]);
  const model = owner?.reader === reader ? owner.model : undefined;
  useEffect(() => {
    model?.refresh(revision);
  }, [model, revision]);
  return model;
}

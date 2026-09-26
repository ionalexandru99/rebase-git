import { useState } from "react";

export interface MergeViewRequest {
  readonly path: string | null;
  readonly open: (path: string) => void;
  readonly close: () => void;
}

export function useMergeViewRequest(): MergeViewRequest {
  const [path, setPath] = useState<string | null>(null);
  return { path, open: setPath, close: () => setPath(null) };
}

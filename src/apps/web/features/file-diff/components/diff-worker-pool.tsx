import {
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from "@pierre/diffs/react";
import DiffWorker from "@pierre/diffs/worker/worker.js?worker";
import type { ComponentProps, ReactNode } from "react";

const poolOptions: WorkerPoolOptions = {
  workerFactory: () => new DiffWorker(),
  poolSize: 2,
  totalASTLRUCacheSize: 8,
};

const highlighterOptions: ComponentProps<
  typeof WorkerPoolContextProvider
>["highlighterOptions"] = {
  theme: "pierre-dark",
  langs: ["typescript", "tsx", "csharp", "json"],
  tokenizeMaxLineLength: 5000,
};

export function DiffWorkerPool({ children }: { readonly children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}

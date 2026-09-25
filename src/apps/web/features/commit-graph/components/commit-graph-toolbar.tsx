import type { ReactNode } from "react";

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2">
      {children}
    </header>
  );
}
function Title({ repositoryName }: { readonly repositoryName: string }) {
  return (
    <h1 className="mr-auto min-w-0 max-w-48 truncate text-[.85rem] font-semibold text-foreground">
      {repositoryName}
    </h1>
  );
}
export const CommitGraphToolbar = { Frame, Title };

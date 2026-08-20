import type { JSX } from "react";

export function TechnicalShell(): JSX.Element {
  return (
    <main className="min-h-svh bg-background p-6 text-foreground">
      <h1 className="text-xl font-semibold">Rebase</h1>
      <p className="mt-2 text-sm text-muted-foreground">Web client ready.</p>
    </main>
  );
}

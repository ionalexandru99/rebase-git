import { Button } from "#web-ui/components/ui/button";

const loadingRowIds = Array.from(
  { length: 12 },
  (_, index) => `commit-loading-row-${index}`,
);

export function CommitGraphLoading() {
  return (
    <div
      aria-label="Loading commit history"
      className="pointer-events-none absolute inset-0 bg-repository"
      role="status"
    >
      {loadingRowIds.map((rowId) => (
        <div
          className="grid h-9 grid-cols-[4rem_minmax(12rem,1fr)_10rem_7rem] items-center border-border/40 border-b px-3"
          key={rowId}
        >
          <span className="h-px w-7 bg-border" />
          <span className="h-2 w-2/5 rounded-sm bg-muted" />
          <span className="h-2 w-20 rounded-sm bg-muted" />
          <span className="h-2 w-12 rounded-sm bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function CommitGraphFailure({
  error,
  retry,
}: {
  readonly error: string;
  readonly retry: () => void;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
      role="alert"
    >
      <p className="m-0 max-w-md text-sm text-muted-foreground">{error}</p>
      <Button onClick={retry} size="sm" variant="outline">
        Retry
      </Button>
    </div>
  );
}

export function CommitGraphPageRetry({
  error,
  retry,
}: {
  readonly error: string;
  readonly retry: () => void;
}) {
  return (
    <div className="flex h-9 items-center gap-3 px-3 text-xs" role="alert">
      <span>{error}</span>
      <Button onClick={retry} size="xs" variant="outline">
        Retry loading history
      </Button>
    </div>
  );
}

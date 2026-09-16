import type { CommitInspection } from "@rebase/contracts/commit-inspection/commit-inspection.contract";

export function CommitMetadata({
  details,
  selectParent,
}: {
  readonly details: CommitInspection;
  readonly selectParent: (oid: string) => void;
}) {
  return (
    <>
      <div className="max-h-64 shrink-0 overflow-auto border-border border-b p-3 text-xs">
        <p className="break-all font-mono text-muted-foreground">
          {details.oid}
        </p>
        <p className="my-3 whitespace-pre-wrap break-words text-sm">
          {details.message}
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          {(["author", "committer"] as const).map((kind) => (
            <div key={kind} className="contents">
              <dt className="text-muted-foreground">
                {kind === "author" ? "Author" : "Committer"}
              </dt>
              <dd className="min-w-0 break-words">
                {details[kind].name} &lt;{details[kind].email}&gt;
                <time
                  className="block text-muted-foreground"
                  dateTime={details[kind].date}
                >
                  {details[kind].date.replace("T", " ")}
                </time>
              </dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Parents</dt>
          <dd className="space-y-1 break-all font-mono">
            {details.parents.length === 0
              ? "None"
              : details.parents.map((oid, index) => (
                  <div key={oid}>
                    {index + 1} · {oid}
                  </div>
                ))}
          </dd>
        </dl>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-border border-b px-3 py-2 text-xs">
        {details.parents.length > 1 ? (
          <>
            <label htmlFor="commit-parent" className="text-muted-foreground">
              Compare with
            </label>
            <select
              id="commit-parent"
              value={details.parentOid ?? ""}
              onChange={(event) => selectParent(event.target.value)}
              className="min-w-0 max-w-full rounded-md border border-input bg-background p-1.5 font-mono"
            >
              {details.parents.map((oid, index) => (
                <option key={oid} value={oid}>
                  Parent {index + 1} · {oid.slice(0, 12)}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="text-muted-foreground">
            Compared with{" "}
            {details.parentOid === null
              ? "empty tree"
              : `parent ${details.parentOid.slice(0, 12)}`}
          </span>
        )}
      </div>
    </>
  );
}

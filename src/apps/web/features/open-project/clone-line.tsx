import { IconDownload, IconFolder } from "@tabler/icons-react";
import { type JSX, useState } from "react";
import {
  RepositoryCatalogApi,
  type RepositoryCatalogEntry,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import type { CloneSource } from "#web/features/open-project/open-project-state.ts";
import { notCreatedMessage } from "#web/features/repository-catalog/repository-not-created.ts";
import { catalogWith } from "#web/features/repository-catalog/use-repository-catalog.ts";
import { FolderPicker } from "#web/features/repository-folder-picker/repository-folder-browser.tsx";
import { childPath } from "#web/features/repository-folder-picker/repository-folder-picker-state.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

export function cloneDestinationId(key: string) {
  return `${key}-destination`;
}

export function CloneLine({
  source,
  onClose,
  onCloned,
}: {
  readonly source: CloneSource;
  readonly onClose: () => void;
  readonly onCloned: (repository: RepositoryCatalogEntry) => void;
}): JSX.Element {
  const defaults = useEnvironmentQuery(
    RepositoryCatalogApi.defaults,
    undefined,
    {
      changes: "none",
    },
  );
  const [path, setPath] = useState<string>();
  const [percent, setPercent] = useState(0);
  const [repositoryId] = useState(() => crypto.randomUUID());
  const [choosing, setChoosing] = useState(false);
  const clone = useCommand(RepositoryCatalogApi.clone, {
    progress: ({ percent }) => setPercent(percent),
    answers: catalogWith,
  });
  const destination =
    path ??
    (defaults.data === undefined
      ? ""
      : childPath(defaults.data.cloneFolder, source.name));
  const failure =
    clone.running ||
    clone.failure === undefined ||
    clone.failure._tag === "Cancelled"
      ? undefined
      : (notCreatedMessage(clone.failure) ?? describeFailure(clone.failure));

  const start = async () => {
    if (clone.running || destination.trim() === "") return;
    setPercent(0);
    const result = await clone.run({
      repositoryId,
      url: source.url,
      path: destination.trim(),
    });
    if (result._tag === "Ok") onCloned(result.value);
  };

  if (clone.running)
    return (
      <div className="flex items-center gap-3 pb-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-meta">
            <span className="min-w-0 truncate text-foreground/85">
              Cloning into{" "}
              <span className="font-mono text-meta text-muted-foreground">
                {destination}
              </span>
            </span>
            <span className="text-muted-foreground tabular-nums">
              {percent}%
            </span>
          </div>
          <div
            aria-label={`Cloning ${source.name}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            className="h-[3px] overflow-hidden rounded-full bg-foreground/12"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <Button
          onClick={clone.cancel}
          size="sm"
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
      </div>
    );

  return (
    <div className="pb-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <label
          className="shrink-0 text-meta text-muted-foreground"
          htmlFor={cloneDestinationId(source.key)}
        >
          Clone into
        </label>
        <Input
          aria-invalid={failure !== undefined}
          autoFocus
          className="h-8 min-w-0 flex-1 font-mono text-control sm:h-8"
          id={cloneDestinationId(source.key)}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          value={destination}
        />
        <Button
          onClick={() => setChoosing(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          <IconFolder aria-hidden="true" />
          Change
        </Button>
        <Button
          disabled={!clone.canRun || destination.trim() === ""}
          size="sm"
          type="submit"
        >
          <IconDownload aria-hidden="true" />
          Clone
        </Button>
      </form>
      {failure === undefined ? null : (
        <p
          aria-live="polite"
          className="mt-1.5 text-meta whitespace-pre-line text-destructive"
        >
          {failure}
        </p>
      )}
      <FolderPicker
        onChosen={(folder) => setPath(childPath(folder, source.name))}
        onOpenChange={setChoosing}
        open={choosing}
        title="Clone into"
      />
    </div>
  );
}

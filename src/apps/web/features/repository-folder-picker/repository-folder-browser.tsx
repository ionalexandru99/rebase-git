import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { IconArrowUp, IconSearch, IconX } from "@tabler/icons-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogTitle,
} from "#web/components/ui/dialog";
import { Input } from "#web/components/ui/input";
import { useFolderBrowser } from "#web/features/repository-folder-picker/hooks/use-folder-browser";
import { RepositoryDirectoryList } from "#web/features/repository-folder-picker/repository-directory-list";
import {
  type RepositoryFolderPickerEnvironment,
  RepositoryFolderPickerEnvironmentSelect,
} from "#web/features/repository-folder-picker/repository-folder-picker-environment-select";
import { filterDirectoryEntries } from "#web/features/repository-folder-picker/repository-folder-picker-state";

export function RepositoryFolderBrowser({
  environment,
  environments,
  chooseEnvironment,
  onRepositoryOpened,
}: {
  readonly environment: RepositoryFolderPickerEnvironment;
  readonly environments: readonly RepositoryFolderPickerEnvironment[];
  readonly chooseEnvironment: (environmentId: string) => void;
  readonly onRepositoryOpened: (repository: RepositoryCatalogEntry) => void;
}): JSX.Element {
  const browser = useFolderBrowser(
    {
      available: environment.availability === "available",
      status: environment.status,
    },
    onRepositoryOpened,
  );
  const { directory, loading } = browser;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);
  const navigate = (path: string) => {
    setQuery("");
    browser.navigate(path);
  };
  const openParent = () => {
    if (directory?.parentPath !== undefined) navigate(directory.parentPath);
  };

  return (
    <>
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border pr-3 pl-[1.1rem]">
        <DialogTitle className="min-w-0 flex-1 text-base font-semibold">
          Choose repository
        </DialogTitle>
        <DialogDescription className="sr-only">
          Browse folders on an Environment and select a Git repository.
        </DialogDescription>
        <RepositoryFolderPickerEnvironmentSelect
          environments={environments}
          onSelect={chooseEnvironment}
          selected={environment}
        />
        <DialogClose
          aria-label="Close"
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <IconX aria-hidden="true" className="size-4" />
        </DialogClose>
      </header>

      <div className="grid min-h-[3.25rem] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-3 py-2">
        <Button
          aria-label="Parent directory"
          disabled={directory?.parentPath === undefined || loading}
          onClick={openParent}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <IconArrowUp aria-hidden="true" />
        </Button>
        {searching ? (
          <Input
            aria-label="Filter current directory"
            className="h-8 bg-white/[.03] sm:h-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter current directory"
            ref={searchRef}
            value={query}
          />
        ) : (
          <nav
            aria-label="Current directory"
            className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs whitespace-nowrap text-muted-foreground"
          >
            {directory?.breadcrumbs.map((breadcrumb, index) => (
              <span className="flex items-center gap-1" key={breadcrumb.path}>
                {index > 0 ? (
                  <span aria-hidden="true" className="text-foreground/25">
                    /
                  </span>
                ) : null}
                <button
                  className="rounded-sm px-1.5 py-1 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:bg-accent disabled:text-foreground"
                  disabled={breadcrumb.path === directory.path || loading}
                  onClick={() => navigate(breadcrumb.path)}
                  type="button"
                >
                  {breadcrumb.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        <Button
          aria-label={
            searching ? "Close directory filter" : "Filter current directory"
          }
          onClick={() => {
            setSearching((current) => !current);
            if (searching) setQuery("");
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {searching ? (
            <IconX aria-hidden="true" />
          ) : (
            <IconSearch aria-hidden="true" />
          )}
        </Button>
      </div>

      <RepositoryDirectoryList
        entries={filterDirectoryEntries(directory?.entries ?? [], query)}
        error={browser.directoryError}
        loading={loading}
        onEnter={navigate}
        onParent={openParent}
        onSelect={browser.select}
        selectedPath={browser.selectedPath}
        truncated={directory?.truncated ?? false}
      />

      <footer className="grid min-h-[3.75rem] shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-border px-3 py-2 max-[540px]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="truncate font-mono text-[.69rem] text-muted-foreground">
            {browser.selectedPath ?? "Select a folder"}
          </p>
          {browser.selectionError !== undefined ? (
            <p
              aria-live="polite"
              className="truncate text-[.68rem] text-destructive"
            >
              {browser.selectionError}
            </p>
          ) : null}
        </div>
        <DialogClose className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-white/[.03] px-3 text-xs font-medium text-foreground/80 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 max-[540px]:hidden">
          Cancel
        </DialogClose>
        <Button
          className="h-8 px-3 text-xs sm:h-8"
          disabled={
            browser.selectedPath === undefined || browser.opening || loading
          }
          onClick={browser.openRepository}
          type="button"
        >
          {browser.opening ? "Opening…" : "Open repository"}
        </Button>
      </footer>
    </>
  );
}

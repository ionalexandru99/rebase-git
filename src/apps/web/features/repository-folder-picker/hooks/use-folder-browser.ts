import { useState } from "react";
import { EnvironmentFilesystemApi } from "#contracts/environment-filesystem/environment-filesystem.contract.ts";
import {
  RepositoryCatalogApi,
  type RepositoryCatalogEntry,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { catalogWith } from "#web/features/repository-catalog/use-repository-catalog.ts";
import {
  directoryListingError,
  repositorySelectionError,
} from "#web/features/repository-folder-picker/repository-folder-picker-state.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

type FolderSelection =
  | { readonly _tag: "None" }
  | { readonly _tag: "Current" }
  | { readonly _tag: "Folder"; readonly path: string };

const nothingSelected: FolderSelection = { _tag: "None" };

export function useFolderBrowser(
  environment: { readonly available: boolean; readonly status: string },
  onRepositoryOpened: (repository: RepositoryCatalogEntry) => void,
) {
  const [location, setLocation] = useState<string>();
  const [selection, setSelection] = useState<FolderSelection>(nothingSelected);
  const listing = useDirectoryListing(location, environment.available);
  const remember = useCommand(RepositoryCatalogApi.remember, {
    answers: catalogWith,
  });
  const directory = listing.isError ? undefined : listing.data;
  const selectedPath =
    directory === undefined
      ? undefined
      : selection._tag === "Folder"
        ? selection.path
        : selection._tag === "Current"
          ? directory.path
          : undefined;

  const navigate = (path: string) => {
    remember.reset();
    setLocation(path);
    setSelection({ _tag: "Current" });
  };

  return {
    directory,
    selectedPath,
    loading: environment.available && listing.isLoading,
    opening: remember.running,
    directoryError: !environment.available
      ? environment.status
      : listing.isError
        ? directoryListingError(listing.error)
        : undefined,
    selectionError:
      remember.failure === undefined
        ? undefined
        : repositorySelectionError(remember.failure),
    navigate,
    select: (path: string) => {
      remember.reset();
      setSelection({ _tag: "Folder", path });
    },
    openRepository: async () => {
      if (selectedPath === undefined || remember.running) return;
      const result = await remember.run({ path: selectedPath });
      if (result._tag === "Ok") onRepositoryOpened(result.value);
    },
  };
}

function useDirectoryListing(path: string | undefined, enabled: boolean) {
  return useEnvironmentQuery(
    EnvironmentFilesystemApi.listDirectory,
    path === undefined ? {} : { path },
    { enabled, changes: "none", staleTime: 0, refetchOnWindowFocus: false },
  );
}

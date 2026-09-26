import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { useState } from "react";
import { useDirectoryListing } from "#web/features/environment-filesystem/index";
import { useRememberRepository } from "#web/features/repository-catalog/index";
import {
  directoryListingError,
  repositorySelectionError,
} from "#web/features/repository-folder-picker/repository-folder-picker-state";

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
  const remember = useRememberRepository();
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
    opening: remember.isPending,
    directoryError: !environment.available
      ? environment.status
      : listing.isError
        ? directoryListingError(listing.error)
        : undefined,
    selectionError: remember.isError
      ? repositorySelectionError(remember.error)
      : undefined,
    navigate,
    select: (path: string) => {
      remember.reset();
      setSelection({ _tag: "Folder", path });
    },
    openRepository: () => {
      if (selectedPath === undefined || remember.isPending) return;
      remember.mutate(
        { path: selectedPath },
        { onSuccess: onRepositoryOpened },
      );
    },
  };
}

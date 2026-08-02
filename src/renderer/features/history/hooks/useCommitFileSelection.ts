import type { CommitDetailFile } from '@shared/schemas/git'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CommitDiffSelection } from '@/features/diff/CommitDiffView'
import { firstCommitTreeFile } from '../commit-file-tree'

export function useCommitFileSelection(sha: string, files: readonly CommitDetailFile[]) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    setSelectedPath((current) =>
      current !== null && files.some((file) => file.path === current)
        ? current
        : (firstCommitTreeFile(files)?.path ?? null)
    )
  }, [files])

  const selectedFile = files.find((file) => file.path === selectedPath)
  const selection = useMemo<CommitDiffSelection | null>(
    () =>
      selectedFile
        ? {
            commit: sha,
            file: selectedFile.path,
            renameSource: selectedFile.oldPath,
            binary: selectedFile.binary
          }
        : null,
    [selectedFile, sha]
  )
  const selectFile = useCallback((file: CommitDetailFile) => {
    setSelectedPath(file.path)
  }, [])

  return { selectedPath, selection, selectFile }
}

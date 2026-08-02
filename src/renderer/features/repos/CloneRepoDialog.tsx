import { deriveCloneFolderName, isSupportedCloneUrl } from '@shared/clone-url'
import { useState } from 'react'
import { CloneRepoDialogView } from './CloneRepoDialogView'
import { useCloneRepo } from './useCloneRepo'

interface CloneRepoDialogProps {
  defaultParentDir: string | null
  onSelectParentDir: () => Promise<string | null>
  onCloned: (repoPath: string) => void
  onClose: () => void
}

export function CloneRepoDialog(props: CloneRepoDialogProps) {
  const [url, setUrl] = useState('')
  const [parentDir, setParentDir] = useState<string | null>(props.defaultParentDir)
  const clone = useCloneRepo()

  const trimmedUrl = url.trim()
  const folderName = deriveCloneFolderName(trimmedUrl)
  const urlLooksValid = trimmedUrl.length === 0 || isSupportedCloneUrl(trimmedUrl)
  const canSubmit =
    !clone.cloning && trimmedUrl.length > 0 && urlLooksValid && folderName !== null && !!parentDir

  const chooseParentDir = async () => {
    const chosen = await props.onSelectParentDir()
    if (chosen) {
      setParentDir(chosen)
    }
  }

  const submit = async () => {
    if (!canSubmit || !parentDir || !folderName) {
      return
    }
    const repoPath = await clone.clone({ url: trimmedUrl, parentDir, folderName })
    if (repoPath) {
      props.onCloned(repoPath)
    }
  }

  const dismiss = () => {
    if (clone.cloning) {
      return
    }
    props.onClose()
  }

  return (
    <CloneRepoDialogView
      url={url}
      parentDir={parentDir}
      folderName={folderName}
      urlLooksValid={urlLooksValid}
      canSubmit={canSubmit}
      cloning={clone.cloning}
      error={clone.error}
      progress={clone.progress}
      onUrlChange={(nextUrl) => {
        setUrl(nextUrl)
        clone.reset()
      }}
      onChooseParentDir={() => void chooseParentDir()}
      onSubmit={() => void submit()}
      onCancel={() => (clone.cloning ? clone.cancel() : props.onClose())}
      onDismiss={dismiss}
    />
  )
}

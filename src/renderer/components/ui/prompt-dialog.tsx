import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface PromptRequest {
  title: string
  label?: string
  initialValue?: string
  placeholder?: string
  confirmText?: string
  allowEmpty?: boolean
  validate?: (value: string) => string | null
  onConfirm: (value: string) => void
}

export interface ConfirmRequest {
  title: string
  message?: string
  confirmText?: string
  destructive?: boolean
  onConfirm: () => void
}

function Overlay(props: { onDismiss: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onDismiss()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [props.onDismiss])

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onDismiss()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
      >
        {props.children}
      </div>
    </div>,
    document.body
  )
}

export function PromptDialog(props: { request: PromptRequest | null; onClose: () => void }) {
  const request = props.request
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fieldId = useId()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (request) {
      setValue(request.initialValue ?? '')
      queueMicrotask(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [request])

  if (!request) {
    return null
  }

  const error = request.validate?.(value.trim()) ?? null
  const canSubmit = (request.allowEmpty || value.trim().length > 0) && !error

  const submit = () => {
    if (!canSubmit) {
      return
    }
    request.onConfirm(value.trim())
    props.onClose()
  }

  return (
    <Overlay onDismiss={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <h2 className="text-sm font-semibold">{request.title}</h2>
        <label htmlFor={fieldId} className="mt-3 block text-xs text-muted-foreground">
          {request.label ?? 'Name'}
        </label>
        <input
          id={fieldId}
          ref={inputRef}
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 h-9 w-full rounded-[var(--r-sm)] border bg-background px-2.5 text-sm outline-none focus:border-border-strong"
        />
        <div className="mt-1 h-4 text-xs text-destructive">{error ?? ''}</div>
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="h-8 rounded-[var(--r-sm)] border bg-card px-3 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="h-8 rounded-[var(--r-sm)] bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {request.confirmText ?? 'Confirm'}
          </button>
        </div>
      </form>
    </Overlay>
  )
}

export function ConfirmDialog(props: { request: ConfirmRequest | null; onClose: () => void }) {
  const request = props.request
  if (!request) {
    return null
  }
  const confirm = () => {
    request.onConfirm()
    props.onClose()
  }
  return (
    <Overlay onDismiss={props.onClose}>
      <h2 className="text-sm font-semibold">{request.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{request.message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={props.onClose}
          className="h-8 rounded-[var(--r-sm)] border bg-card px-3 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          className={cn(
            'h-8 rounded-[var(--r-sm)] px-3 text-sm font-medium',
            request.destructive ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground'
          )}
        >
          {request.confirmText ?? 'Confirm'}
        </button>
      </div>
    </Overlay>
  )
}

export function useDialogs() {
  const [promptRequest, setPromptRequest] = useState<PromptRequest | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const dialogs: ReactNode = (
    <>
      <PromptDialog request={promptRequest} onClose={() => setPromptRequest(null)} />
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </>
  )

  return {
    prompt: (request: PromptRequest) => setPromptRequest(request),
    confirm: (request: ConfirmRequest) => setConfirmRequest(request),
    dialogs
  }
}

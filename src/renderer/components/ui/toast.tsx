import * as React from 'react'

import { cn } from '@/lib/utils'

const toastStyles = {
  default: 'bg-background text-foreground border',
  success: 'bg-green-900/50 text-green-100 border-green-800',
  error: 'bg-red-900/50 text-red-100 border-red-800',
  warning: 'bg-yellow-900/50 text-yellow-100 border-yellow-800'
}

interface Toast {
  id: string
  message: string
  type: keyof typeof toastStyles
  duration?: number
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (message: string, type?: Toast['type'], duration?: number) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextType>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {}
})

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = React.useCallback(
    (message: string, type: Toast['type'] = 'default', duration = 3000) => {
      const id = Math.random().toString(36).substring(2, 9)
      setToasts((prev) => [...prev, { id, message, type, duration }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    },
    []
  )

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-center justify-between rounded-lg border p-4 shadow-lg transition-all',
              toastStyles[toast.type]
            )}
          >
            <p className="text-sm">{toast.message}</p>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="ml-4 text-sm opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => React.useContext(ToastContext)

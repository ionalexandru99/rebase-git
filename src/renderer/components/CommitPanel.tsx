import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface CommitPanelProps {
  onCommit: (message: string) => Promise<boolean>
  loading: boolean
}

export function CommitPanel({ onCommit, loading }: CommitPanelProps) {
  const [message, setMessage] = useState('')

  const handleCommit = async () => {
    const trimmed = message.trim()
    if (!trimmed) return
    const success = await onCommit(trimmed)
    if (success) {
      setMessage('')
    }
  }

  return (
    <div className="bg-card rounded-lg p-4 border border-border">
      <h2 className="text-base font-semibold text-card-foreground mb-3">Commit</h2>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Enter commit message..."
        rows={3}
        className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none mb-3"
      />
      <Button className="w-full" onClick={handleCommit} disabled={!message.trim() || loading}>
        {loading ? 'Committing...' : 'Commit'}
      </Button>
    </div>
  )
}

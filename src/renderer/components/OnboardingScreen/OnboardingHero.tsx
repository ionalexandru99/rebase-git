import { GitBranch } from 'lucide-react'

export function OnboardingHero() {
  return (
    <div className="mb-6 text-center">
      <div className="mx-auto mb-3.5 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 ring-1 ring-inset ring-primary/30">
        <GitBranch className="h-4 w-4 text-primary" strokeWidth={2} />
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Welcome to Rebase</h1>
      <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
        Set up your workspace by choosing the folder where you keep your Git repositories.
      </p>
    </div>
  )
}

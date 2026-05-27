import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingScreen } from '../OnboardingScreen'

const defaultProps = {
  workingDirectory: null,
  discoveredRepos: [],
  loading: false,
  error: null,
  onSelectDirectory: vi.fn().mockResolvedValue(null),
  onComplete: vi.fn(),
  onOpenRepo: vi.fn()
}

describe('OnboardingScreen', () => {
  it('should render welcome message and select folder button', () => {
    render(<OnboardingScreen {...defaultProps} />)

    expect(screen.getByText('Welcome to Rebase')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Set up your workspace by choosing the folder where you keep your Git repositories/
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Select Working Folder/i })).toBeInTheDocument()
  })

  it('should call onSelectDirectory when button is clicked', () => {
    const onSelectDirectory = vi.fn().mockResolvedValue(null)
    render(<OnboardingScreen {...defaultProps} onSelectDirectory={onSelectDirectory} />)

    const button = screen.getByRole('button', { name: /Select Working Folder/i })
    fireEvent.click(button)

    expect(onSelectDirectory).toHaveBeenCalledTimes(1)
  })

  it('should show working directory and discovered repos after selection', () => {
    render(
      <OnboardingScreen
        {...defaultProps}
        workingDirectory="/home/user/projects"
        discoveredRepos={['/home/user/projects/app', '/home/user/projects/lib']}
      />
    )

    expect(screen.getByText('/home/user/projects')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Found 2 repositories/i })).toBeInTheDocument()
    expect(screen.getByText('/home/user/projects/app')).toBeInTheDocument()
    expect(screen.getByText('/home/user/projects/lib')).toBeInTheDocument()
  })

  it('should call onOpenRepo when a discovered repo is clicked', () => {
    const onOpenRepo = vi.fn()
    render(
      <OnboardingScreen
        {...defaultProps}
        workingDirectory="/home/user/projects"
        discoveredRepos={['/home/user/projects/app']}
        onOpenRepo={onOpenRepo}
      />
    )

    const repoItem = screen.getByText('/home/user/projects/app')
    fireEvent.click(repoItem)

    expect(onOpenRepo).toHaveBeenCalledWith('/home/user/projects/app')
  })

  it('should call onComplete when Get Started is clicked', () => {
    const onComplete = vi.fn()
    render(
      <OnboardingScreen
        {...defaultProps}
        workingDirectory="/home/user/projects"
        onComplete={onComplete}
      />
    )

    const button = screen.getByRole('button', { name: /Get Started/i })
    fireEvent.click(button)

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('should show loading state', () => {
    render(<OnboardingScreen {...defaultProps} loading={true} />)

    const button = screen.getByRole('button', { name: /Select Working Folder/i })
    expect(button).toBeDisabled()
  })

  it('should show error message', () => {
    render(
      <OnboardingScreen {...defaultProps} workingDirectory="/bad/path" error="Permission denied" />
    )

    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('should show no repos found message when directory is empty', () => {
    render(
      <OnboardingScreen
        {...defaultProps}
        workingDirectory="/home/user/empty"
        discoveredRepos={[]}
      />
    )

    expect(screen.getByText('No git repositories found in this folder.')).toBeInTheDocument()
  })

  it('should show singular repository count', () => {
    render(
      <OnboardingScreen
        {...defaultProps}
        workingDirectory="/home/user/projects"
        discoveredRepos={['/home/user/projects/app']}
      />
    )

    expect(screen.getByText('Found 1 repository')).toBeInTheDocument()
  })
})

import { Channel } from '@shared/channels'
import { app, type BrowserWindow, dialog, shell, webContents } from 'electron'
import log from 'electron-log'
import {
  RECOVERY_BUTTONS,
  recoveryActionForResponse,
  shouldPromptOnRenderGone,
  shouldRespawnSidecar
} from './recovery-decision'
import { restartSidecar } from './sidecar'

const SAMPLE_INTERVAL_MS = 2000

interface SamplerHandle {
  stop: () => void
}

function startUnresponsiveSampler(): SamplerHandle {
  const startedAt = Date.now()
  log.warn('[recovery] window became unresponsive')
  const interval = setInterval(() => {
    const metrics = app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      cpuPercent: Math.round(metric.cpu.percentCPUUsage)
    }))
    log.warn(`[recovery] still unresponsive after ${Date.now() - startedAt}ms`, metrics)
  }, SAMPLE_INTERVAL_MS)
  return {
    stop: () => {
      clearInterval(interval)
      log.warn(`[recovery] window recovered after ${Date.now() - startedAt}ms`)
    }
  }
}

async function promptRecovery(win: BrowserWindow): Promise<void> {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [...RECOVERY_BUTTONS],
    defaultId: 0,
    cancelId: 0,
    title: 'Rebase is not responding',
    message: 'Rebase is not responding',
    detail:
      'The window has stopped responding. Keep waiting for it to recover, reload it, export logs, or quit.'
  })

  switch (recoveryActionForResponse(response)) {
    case 'reload':
      win.webContents.reloadIgnoringCache()
      break
    case 'export-logs':
      shell.showItemInFolder(log.transports.file.getFile().path)
      break
    case 'quit':
      app.quit()
      break
    case 'wait':
      break
  }
}

export function wireWindowRecovery(win: BrowserWindow): void {
  let sampler: SamplerHandle | null = null
  let promptOpen = false

  win.on('unresponsive', () => {
    if (!sampler) {
      sampler = startUnresponsiveSampler()
    }
    if (promptOpen) {
      return
    }
    promptOpen = true
    void promptRecovery(win).finally(() => {
      promptOpen = false
    })
  })

  win.on('responsive', () => {
    sampler?.stop()
    sampler = null
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('[recovery] render process gone', details)
    if (!shouldPromptOnRenderGone(details.reason) || win.isDestroyed()) {
      return
    }
    void dialog
      .showMessageBox(win, {
        type: 'error',
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
        cancelId: 0,
        title: 'Rebase crashed',
        message: 'The Rebase window stopped working.',
        detail: `Reason: ${details.reason}. Reload to recover your session.`
      })
      .then(({ response }) => {
        if (response === 0 && !win.isDestroyed()) {
          win.reload()
        } else {
          app.quit()
        }
      })
  })
}

function broadcastSidecarRestarted(): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) {
      contents.send(Channel.sidecarRestarted)
    }
  }
}

export function wireProcessRecovery(): void {
  app.on('child-process-gone', (_event, details) => {
    log.error('[recovery] child process gone', details)
    if (!shouldRespawnSidecar(details)) {
      return
    }
    restartSidecar()
      .then(() => {
        broadcastSidecarRestarted()
      })
      .catch((error: unknown) => {
        log.error('[recovery] sidecar respawn failed', error)
      })
  })
}

export type WebProfile = { id: string; name: string }

export type WebviewState = {
  profileId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}

export type WebviewProfiles = {
  profiles: WebProfile[]
  activeProfileId: string
}

export type WebviewBounds = { x: number; y: number; width: number; height: number }

/** What one step of a website script does. */
export type ScriptAction = 'open' | 'wait' | 'wait-for' | 'wait-load' | 'click' | 'type' | 'press' | 'scroll' | 'extract'

/**
 * One step. `selector` is a CSS selector, `value` holds the URL, text, key or pixel
 * amount depending on the action, and `timeout` (ms) applies to waits.
 */
export type ScriptStep = { id: string; action: ScriptAction; selector?: string; value?: string; timeout?: number }

export type WebScript = { id: string; name: string; repeat: number; steps: ScriptStep[]; updatedAt: number }

export type ScriptLogEntry = { at: number; level: 'info' | 'success' | 'error'; message: string }

export type ScriptRun = {
  runId: string
  scriptId: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  /** Index of the step being run, or -1 between rounds. */
  step: number
  round: number
  log: ScriptLogEntry[]
}

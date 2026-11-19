import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { ScriptAction, ScriptLogEntry, ScriptStep, WebScript } from './types'

export const maxScripts = 100
const maxSteps = 100
const actions: ScriptAction[] = ['open', 'wait', 'wait-for', 'wait-load', 'click', 'type', 'press', 'scroll', 'extract']
const needsSelector: ScriptAction[] = ['wait-for', 'click', 'type', 'extract']
const needsValue: ScriptAction[] = ['open', 'type', 'press']
const defaultTimeout = 10_000

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Error(`Text is too long (max ${max} characters)`)
  return trimmed || undefined
}

function cleanStep(value: unknown, index: number): ScriptStep {
  if (!value || typeof value !== 'object') throw new Error(`Step ${index + 1} is invalid`)
  const raw = value as Record<string, unknown>
  const action = raw.action as ScriptAction
  if (!actions.includes(action)) throw new Error(`Step ${index + 1} has an unknown action`)
  const selector = text(raw.selector, 500)
  // Typed text keeps its spaces; everything else is trimmed.
  let stepValue: string | undefined
  if (action === 'type' && typeof raw.value === 'string') {
    if (raw.value.length > 2000) throw new Error(`Step ${index + 1}: text is too long`)
    stepValue = raw.value
  } else stepValue = text(raw.value, 2000)
  if (needsSelector.includes(action) && !selector) throw new Error(`Step ${index + 1} needs a CSS selector`)
  if (needsValue.includes(action) && !stepValue) throw new Error(`Step ${index + 1} needs a value`)
  if (action === 'wait' && !(Number(stepValue) >= 0 && Number(stepValue) <= 600_000)) throw new Error(`Step ${index + 1}: wait between 0 and 600000 ms`)
  const timeout = typeof raw.timeout === 'number' && Number.isFinite(raw.timeout) ? Math.min(120_000, Math.max(100, Math.round(raw.timeout))) : undefined
  const id = typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : randomUUID()
  return { id, action, ...(selector ? { selector } : {}), ...(stepValue !== undefined ? { value: stepValue } : {}), ...(timeout ? { timeout } : {}) }
}

export function cleanScript(value: unknown): WebScript {
  if (!value || typeof value !== 'object') throw new Error('Invalid script')
  const raw = value as Record<string, unknown>
  const name = text(raw.name, 60)
  if (!name) throw new Error('Enter a script name (1–60 characters)')
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw new Error('Add at least one step')
  if (raw.steps.length > maxSteps) throw new Error(`A script can have at most ${maxSteps} steps`)
  const repeat = Math.min(100, Math.max(1, Math.round(Number(raw.repeat) || 1)))
  const id = typeof raw.id === 'string' && /^[a-f\d-]{36}$/.test(raw.id) ? raw.id : randomUUID()
  return { id, name, repeat, steps: raw.steps.map(cleanStep), updatedAt: Date.now() }
}

/** A starter script so the panel is not empty on first open. */
export function exampleScript(): WebScript {
  return {
    id: randomUUID(), name: 'Google search', repeat: 1, updatedAt: Date.now(),
    steps: [
      { id: randomUUID(), action: 'open', value: 'https://www.google.com/' },
      { id: randomUUID(), action: 'type', selector: 'textarea[name=q], input[name=q]', value: 'Miniapp Studio' },
      { id: randomUUID(), action: 'press', value: 'Enter' },
      { id: randomUUID(), action: 'wait-for', selector: '#search', timeout: 15_000 },
      { id: randomUUID(), action: 'extract', selector: '#search h3' }
    ]
  }
}

export type RunControl = { stopped: boolean }
type Log = (level: ScriptLogEntry['level'], message: string) => void

class Stopped extends Error {}

async function sleep(ms: number, control: RunControl): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (control.stopped) throw new Stopped()
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, end - Date.now())))
  }
  if (control.stopped) throw new Stopped()
}

// Arguments go into the page as JSON so selectors and text can never break out of the snippet.
function inPage<T>(contents: WebContents, body: string, args: Record<string, unknown>): Promise<T> {
  if (contents.isDestroyed()) throw new Error('The page was closed')
  return contents.executeJavaScript(`((args) => { ${body} })(${JSON.stringify(args)})`, true) as Promise<T>
}

async function waitFor(contents: WebContents, selector: string, timeout: number, control: RunControl): Promise<void> {
  const end = Date.now() + timeout
  for (;;) {
    const found = await inPage<boolean>(contents, 'return !!document.querySelector(args.selector)', { selector }).catch(() => false)
    if (found) return
    if (Date.now() > end) throw new Error(`Timed out waiting for ${selector}`)
    await sleep(200, control)
  }
}

async function waitLoad(contents: WebContents, timeout: number, control: RunControl): Promise<void> {
  const end = Date.now() + timeout
  // Give a click or key press a moment to start a navigation before checking.
  await sleep(300, control)
  while (contents.isLoading()) {
    if (Date.now() > end) throw new Error('Timed out waiting for the page to load')
    await sleep(200, control)
  }
}

const keyNames: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', ' ': 'Space' }

function press(contents: WebContents, key: string): void {
  const keyCode = keyNames[key] ?? key
  contents.sendInputEvent({ type: 'keyDown', keyCode })
  if (key === 'Enter') contents.sendInputEvent({ type: 'char', keyCode: '\r' })
  else if (key.length === 1) contents.sendInputEvent({ type: 'char', keyCode: key })
  contents.sendInputEvent({ type: 'keyUp', keyCode })
}

export function describeStep(step: ScriptStep): string {
  switch (step.action) {
    case 'open': return `Open ${step.value}`
    case 'wait': return `Wait ${step.value} ms`
    case 'wait-for': return `Wait for ${step.selector}`
    case 'wait-load': return 'Wait for page load'
    case 'click': return `Click ${step.selector}`
    case 'type': return `Type into ${step.selector}`
    case 'press': return `Press ${step.value}`
    case 'scroll': return step.selector ? `Scroll to ${step.selector}` : `Scroll ${step.value || 600}px`
    case 'extract': return `Read text of ${step.selector}`
  }
}

export async function runStep(contents: WebContents, step: ScriptStep, control: RunControl, log: Log, toUrl: (value: string) => string): Promise<void> {
  const timeout = step.timeout ?? defaultTimeout
  switch (step.action) {
    case 'open':
      await contents.loadURL(toUrl(step.value!)).catch((error: unknown) => {
        // A redirect or in-page navigation aborts the first load; that still counts as opened.
        if (!String(error).includes('ERR_ABORTED')) throw error
      })
      return
    case 'wait': return sleep(Number(step.value), control)
    case 'wait-for': return waitFor(contents, step.selector!, timeout, control)
    case 'wait-load': return waitLoad(contents, timeout, control)
    case 'click': {
      await waitFor(contents, step.selector!, timeout, control)
      await inPage(contents, 'const el = document.querySelector(args.selector); el.scrollIntoView({ block: "center" }); el.click()', { selector: step.selector })
      return
    }
    case 'type': {
      await waitFor(contents, step.selector!, timeout, control)
      // Use the native value setter so frameworks such as React notice the change.
      await inPage(contents, `
        const el = document.querySelector(args.selector)
        el.focus()
        if (el.isContentEditable) { document.execCommand('selectAll'); document.execCommand('insertText', false, args.text); return }
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (setter) setter.call(el, args.text); else el.value = args.text
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))`, { selector: step.selector, text: step.value ?? '' })
      return
    }
    case 'press': press(contents, step.value!); return
    case 'scroll':
      if (step.selector) {
        await waitFor(contents, step.selector, timeout, control)
        await inPage(contents, 'document.querySelector(args.selector).scrollIntoView({ block: "center" })', { selector: step.selector })
      } else await inPage(contents, 'window.scrollBy(0, args.y)', { y: Number(step.value) || 600 })
      return
    case 'extract': {
      await waitFor(contents, step.selector!, timeout, control)
      const texts = await inPage<string[]>(contents, 'return [...document.querySelectorAll(args.selector)].slice(0, 20).map((el) => (el.innerText || el.textContent || "").trim().slice(0, 300)).filter(Boolean)', { selector: step.selector })
      if (texts.length === 0) log('info', `${step.selector}: no text`)
      for (const item of texts) log('success', item)
      return
    }
  }
}

export function isStopped(error: unknown): boolean { return error instanceof Stopped }

import {
  ArrowDownOutlined, ArrowLeftOutlined, ArrowUpOutlined, CaretRightOutlined, CopyOutlined, DeleteOutlined,
  EditOutlined, LinkOutlined, PauseOutlined, PlusOutlined, ThunderboltOutlined
} from '@ant-design/icons'
import { AutoComplete, Button, Empty, Input, InputNumber, Popconfirm, Progress, Select, Tag, Tooltip, Typography, message } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { ScriptAction, ScriptRun, ScriptStep, WebScript } from './types'

const { Text } = Typography

const actionOptions: { value: ScriptAction; label: string }[] = [
  { value: 'open', label: 'Open URL' },
  { value: 'click', label: 'Click element' },
  { value: 'type', label: 'Type text' },
  { value: 'press', label: 'Press key' },
  { value: 'wait', label: 'Wait' },
  { value: 'wait-for', label: 'Wait for element' },
  { value: 'wait-load', label: 'Wait for page load' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'extract', label: 'Read text' }
]
const actionLabel = Object.fromEntries(actionOptions.map((item) => [item.value, item.label])) as Record<ScriptAction, string>
const keyOptions = ['Enter', 'Tab', 'Escape', 'Backspace', 'Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp'].map((value) => ({ value }))
const usesSelector: ScriptAction[] = ['click', 'type', 'wait-for', 'extract', 'scroll']
const usesTimeout: ScriptAction[] = ['click', 'type', 'wait-for', 'wait-load', 'extract']

type Draft = { id?: string; name: string; repeat: number; steps: ScriptStep[] }

const newStep = (action: ScriptAction = 'click'): ScriptStep => ({ id: crypto.randomUUID(), action })
const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)

function StepEditor({ step, index, count, currentUrl, onChange, onMove, onRemove }: {
  step: ScriptStep; index: number; count: number; currentUrl: string
  onChange: (step: ScriptStep) => void; onMove: (offset: number) => void; onRemove: () => void
}) {
  const set = (patch: Partial<ScriptStep>) => onChange({ ...step, ...patch })
  return <div className="script-step">
    <div className="script-step-head">
      <span className="script-step-index">{index + 1}</span>
      <Select size="small" value={step.action} options={actionOptions} onChange={(action) => onChange({ id: step.id, action })} className="flex-1" popupMatchSelectWidth={false} />
      <Tooltip title="Move up"><Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move step up" /></Tooltip>
      <Tooltip title="Move down"><Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move step down" /></Tooltip>
      <Tooltip title="Remove step"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onRemove} aria-label="Remove step" /></Tooltip>
    </div>
    <div className="script-step-fields">
      {step.action === 'open' && <Input size="small" placeholder="https://example.com" value={step.value} onChange={(event) => set({ value: event.target.value })}
        suffix={<Tooltip title="Use current page"><LinkOutlined className="cursor-pointer" onClick={() => set({ value: currentUrl })} /></Tooltip>} />}
      {usesSelector.includes(step.action) && <Input size="small" className="font-mono" placeholder={step.action === 'scroll' ? 'CSS selector (optional)' : 'CSS selector, e.g. button[type=submit]'} value={step.selector} onChange={(event) => set({ selector: event.target.value })} />}
      {step.action === 'type' && <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} placeholder="Text to type" value={step.value} onChange={(event) => set({ value: event.target.value })} />}
      {step.action === 'press' && <AutoComplete size="small" options={keyOptions} placeholder="Key, e.g. Enter" value={step.value} onChange={(value) => set({ value })} />}
      {step.action === 'wait' && <InputNumber size="small" min={0} max={600000} step={500} suffix="ms" placeholder="1000" value={step.value ? Number(step.value) : null} onChange={(value) => set({ value: value === null ? undefined : String(value) })} className="w-full" />}
      {step.action === 'scroll' && !step.selector && <InputNumber size="small" step={200} suffix="px" placeholder="Scroll by 600" value={step.value ? Number(step.value) : null} onChange={(value) => set({ value: value === null ? undefined : String(value) })} className="w-full" />}
      {usesTimeout.includes(step.action) && <InputNumber size="small" min={0.1} max={120} step={1} prefix="Timeout" suffix="s" placeholder="10" value={step.timeout ? step.timeout / 1000 : null} onChange={(value) => set({ timeout: value === null ? undefined : Math.round(value * 1000) })} className="w-full" />}
    </div>
  </div>
}

function ScriptEditor({ draft, currentUrl, onCancel, onSaved }: { draft: Draft; currentUrl: string; onCancel: () => void; onSaved: (script: WebScript) => void }) {
  const [value, setValue] = useState(draft)
  const [saving, setSaving] = useState(false)
  const updateStep = (index: number, step: ScriptStep) => setValue((current) => ({ ...current, steps: current.steps.map((item, at) => at === index ? step : item) }))
  const moveStep = (index: number, offset: number) => setValue((current) => {
    const steps = [...current.steps]
    const [item] = steps.splice(index, 1)
    steps.splice(index + offset, 0, item)
    return { ...current, steps }
  })

  async function save() {
    setSaving(true)
    try {
      const script = await window.desktop!.modules.invoke<WebScript>('webview', 'save-script', value)
      message.success('Script saved')
      onSaved(script)
    } catch (cause) { message.error(errorText(cause)) } finally { setSaving(false) }
  }

  return <div className="script-editor">
    <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={onCancel} className="self-start">All scripts</Button>
    <div className="script-editor-meta">
      <label><span>Name</span><Input placeholder="My script" maxLength={60} value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} autoFocus={!value.id} /></label>
      <label><span>Repeat</span><InputNumber min={1} max={100} value={value.repeat} onChange={(repeat) => setValue({ ...value, repeat: repeat ?? 1 })} suffix="×" /></label>
    </div>
    <div className="script-steps-title"><Text strong>Steps</Text><Text type="secondary">{value.steps.length} / 100</Text></div>
    <div className="script-steps">
      {value.steps.map((step, index) => <StepEditor key={step.id} step={step} index={index} count={value.steps.length} currentUrl={currentUrl}
        onChange={(next) => updateStep(index, next)} onMove={(offset) => moveStep(index, offset)}
        onRemove={() => setValue({ ...value, steps: value.steps.filter((item) => item.id !== step.id) })} />)}
      <Button type="dashed" block icon={<PlusOutlined />} disabled={value.steps.length >= 100} onClick={() => setValue({ ...value, steps: [...value.steps, newStep()] })}>Add step</Button>
    </div>
    <div className="script-editor-actions">
      <Button onClick={onCancel}>Cancel</Button>
      <Button type="primary" loading={saving} disabled={!value.name.trim() || value.steps.length === 0} onClick={() => void save()}>Save script</Button>
    </div>
  </div>
}

function RunLog({ run, script }: { run: ScriptRun; script?: WebScript }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [run.log.length])
  const steps = script?.steps.length ?? 0
  const rounds = script?.repeat ?? 1
  const done = run.status === 'done' ? 100 : steps ? Math.round((((run.round - 1) * steps) + Math.max(0, run.step)) / (steps * rounds) * 100) : 0
  const color = { running: 'processing', done: 'success', failed: 'error', stopped: 'default' }[run.status]
  return <div className="script-run">
    <div className="script-run-head">
      <Text strong ellipsis>{script?.name ?? 'Deleted script'}</Text>
      <Tag color={color} className="m-0">{run.status}</Tag>
    </div>
    <Progress percent={done} size="small" showInfo={false} status={run.status === 'failed' ? 'exception' : run.status === 'running' ? 'active' : 'normal'} />
    <div className="script-log" role="log" aria-live="polite">
      {run.log.map((entry, index) => <div key={index} className={`script-log-${entry.level}`}>
        <time>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{entry.message}</span>
      </div>)}
      <div ref={end} />
    </div>
  </div>
}

export function ScriptsPanel({ currentUrl, ready, run, onRunChange }: { currentUrl: string; ready: boolean; run: ScriptRun | null; onRunChange: (run: ScriptRun | null) => void }) {
  const [scripts, setScripts] = useState<WebScript[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const running = run?.status === 'running'

  useEffect(() => {
    void window.desktop?.modules.invoke<WebScript[]>('webview', 'scripts').then(setScripts).catch((cause: unknown) => message.error(errorText(cause)))
  }, [])

  async function start(script: WebScript) {
    try { onRunChange(await window.desktop!.modules.invoke<ScriptRun>('webview', 'run-script', script.id)) } catch (cause) { message.error(errorText(cause)) }
  }

  async function remove(script: WebScript) {
    try { setScripts(await window.desktop!.modules.invoke<WebScript[]>('webview', 'delete-script', script.id)) } catch (cause) { message.error(errorText(cause)) }
  }

  if (draft) return <ScriptEditor draft={draft} currentUrl={currentUrl} onCancel={() => setDraft(null)} onSaved={(script) => {
    setScripts((current) => current.some((item) => item.id === script.id) ? current.map((item) => item.id === script.id ? script : item) : [...current, script])
    setDraft(null)
  }} />

  return <div className="scripts-panel">
    <div className="scripts-intro">
      <Text type="secondary">Automate clicks, typing and waits on the page open in this profile.</Text>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setDraft({ name: '', repeat: 1, steps: [{ ...newStep('open'), value: currentUrl }] })}>New script</Button>
    </div>
    {scripts.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No scripts yet" /> : <div className="script-list">
      {scripts.map((script) => {
        const active = running && run?.scriptId === script.id
        return <div key={script.id} className={`script-card${active ? ' running' : ''}`}>
          <div className="script-card-icon"><ThunderboltOutlined /></div>
          <div className="script-card-copy">
            <Text strong ellipsis>{script.name}</Text>
            <Text type="secondary" ellipsis>{script.steps.map((step) => actionLabel[step.action]).join(' → ')}</Text>
            <span className="script-card-meta">{script.steps.length} steps{script.repeat > 1 ? ` · repeat ${script.repeat}×` : ''}</span>
          </div>
          <div className="script-card-actions">
            {active
              ? <Tooltip title="Stop"><Button shape="circle" danger icon={<PauseOutlined />} onClick={() => void window.desktop?.modules.invoke('webview', 'stop-script')} aria-label="Stop script" /></Tooltip>
              : <Tooltip title={ready ? 'Run on current page' : 'Open a page first'}><Button shape="circle" type="primary" icon={<CaretRightOutlined />} disabled={!ready || running} onClick={() => void start(script)} aria-label={`Run ${script.name}`} /></Tooltip>}
            <Tooltip title="Edit"><Button type="text" size="small" icon={<EditOutlined />} disabled={active} onClick={() => setDraft({ ...script })} aria-label="Edit script" /></Tooltip>
            <Tooltip title="Duplicate"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => setDraft({ name: `${script.name} copy`.slice(0, 60), repeat: script.repeat, steps: script.steps.map((step) => ({ ...step, id: crypto.randomUUID() })) })} aria-label="Duplicate script" /></Tooltip>
            <Popconfirm placement="bottomRight" title="Delete this script?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => void remove(script)} disabled={active}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={active} aria-label="Delete script" />
            </Popconfirm>
          </div>
        </div>
      })}
    </div>}
    {run && <RunLog run={run} script={scripts.find((item) => item.id === run.scriptId)} />}
  </div>
}

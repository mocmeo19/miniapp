import { CheckCircleFilled, RobotOutlined } from '@ant-design/icons'
import { Card, Checkbox, Tag, message } from 'antd'
import { useEffect, useState } from 'react'
import type { AutoTagModels } from '../../../library/types'
import { errorText } from '../errorText'

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

export function AutoTagModelsCard() {
  const library = window.desktop?.library
  const [state, setState] = useState<AutoTagModels | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { void library?.autoTagModels().then(setState).catch(() => undefined) }, [library])

  async function toggle(id: string, checked: boolean) {
    if (!library || !state) return
    const selected = checked ? [...state.selected, id] : state.selected.filter((item) => item !== id)
    setSaving(true)
    try {
      setState(await library.setAutoTagModels(selected))
      message.success('Auto-tag models saved. Photos will be tagged again with the new selection.')
    } catch (cause) { message.error(errorText(cause)) }
    finally { setSaving(false) }
  }

  return <Card className="settings-card"><div className="settings-row settings-row-top">
    <div className="settings-icon"><RobotOutlined /></div>
    <div>
      <h3>Auto-tag models</h3>
      <p>Choose which models Library uses to tag photos. Photos are analyzed on this device; models download the first time they are used. Changing the selection tags photos again — tags you added yourself are kept.</p>
      <div className="autotag-models">
        {(state?.models ?? []).map((model) => {
          const checked = state?.selected.includes(model.id) ?? false
          return <label key={model.id} className={`autotag-model ${checked ? 'is-selected' : ''}`}>
            <Checkbox checked={checked} disabled={saving || (checked && state?.selected.length === 1)} onChange={(event) => void toggle(model.id, event.target.checked)} />
            <span className="autotag-model-copy">
              <strong>{model.name} {model.downloaded ? <Tag icon={<CheckCircleFilled />} color="success">Downloaded</Tag> : <Tag>{megabytes(model.size)} download</Tag>}</strong>
              <small>{model.description}</small>
              <span className="autotag-model-tags">{model.tagExamples.map((tag) => <Tag key={tag}>{tag}</Tag>)}</span>
              <small className="autotag-model-license">License: {model.license}</small>
            </span>
          </label>
        })}
        {!state && <small>{library ? 'Loading models…' : 'Open the Electron app to choose models.'}</small>}
      </div>
    </div>
  </div></Card>
}

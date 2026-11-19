import { CheckOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Avatar, Button, Input, Popconfirm, Typography, message } from 'antd'
import { useState } from 'react'
import type { WebProfile, WebviewProfiles } from './types'

const { Text } = Typography
const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)

export function ProfilesPanel({ profiles, profileId, onSelect, onChanged }: {
  profiles: WebProfile[]; profileId: string
  onSelect: (id: string) => void; onChanged: (result: WebviewProfiles) => void
}) {
  const [name, setName] = useState('')

  async function create() {
    if (!name.trim()) return
    try {
      const profile = await window.desktop!.modules.invoke<WebProfile>('webview', 'create-profile', name)
      onChanged({ profiles: [...profiles, profile], activeProfileId: profile.id })
      setName('')
    } catch (cause) { message.error(errorText(cause)) }
  }

  async function remove(profile: WebProfile) {
    try {
      onChanged(await window.desktop!.modules.invoke<WebviewProfiles>('webview', 'delete-profile', profile.id))
      message.success('Profile and browsing data deleted')
    } catch (cause) { message.error(errorText(cause)) }
  }

  return <div className="profiles-panel">
    <Text type="secondary">Each profile keeps its own cookies, sign-ins and history.</Text>
    <div className="profile-list" role="listbox" aria-label="Browser profiles">
      {profiles.map((profile) => {
        const active = profile.id === profileId
        return <div key={profile.id} role="option" aria-selected={active} tabIndex={0} className={`profile-row${active ? ' active' : ''}`}
          onClick={() => onSelect(profile.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(profile.id) } }}>
          <Avatar size={30} className="profile-avatar">{profile.name.slice(0, 1).toUpperCase()}</Avatar>
          <Text strong ellipsis className="flex-1">{profile.name}</Text>
          {active && <CheckOutlined className="text-(--accent)" />}
          <span onClick={(event) => event.stopPropagation()}>
            <Popconfirm placement="bottomRight" title="Delete this profile?" description="Cookies, cache and site data will be removed." okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => void remove(profile)} disabled={profiles.length < 2}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={profiles.length < 2} aria-label={`Delete ${profile.name}`} />
            </Popconfirm>
          </span>
        </div>
      })}
    </div>
    <div className="profile-add">
      <Input placeholder="New profile name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} onPressEnter={() => void create()} />
      <Button type="primary" icon={<PlusOutlined />} disabled={!name.trim()} onClick={() => void create()}>Add</Button>
    </div>
  </div>
}

import { CheckOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Popconfirm, Tooltip, message } from 'antd'
import { useState } from 'react'
import { CategoryDot } from './charts'
import type { ExpenseCategory } from './types'

const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)

export function CategoriesModal({ open, categories, onClose, onChanged }: { open: boolean; categories: ExpenseCategory[]; onClose: () => void; onChanged: (categories: ExpenseCategory[]) => void }) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  async function call(action: string, payload: unknown) {
    try {
      onChanged(await window.desktop!.modules.invoke<ExpenseCategory[]>('expenses', action, payload))
      return true
    } catch (cause) { message.error(errorText(cause)); return false }
  }

  async function add() {
    if (name.trim() && await call('save-category', { name })) setName('')
  }

  async function rename() {
    if (editing && editing.name.trim() && await call('save-category', editing)) setEditing(null)
  }

  return <Modal open={open} onCancel={onClose} title="Categories" footer={<Button onClick={onClose}>Done</Button>} width={460}>
    <p className="categories-hint">Deleting a category moves its spending to “Other”.</p>
    <div className="categories-list">
      {categories.map((category) => <div key={category.id} className="categories-item">
        <CategoryDot category={category} />
        {editing?.id === category.id
          ? <Input size="small" autoFocus maxLength={40} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} onPressEnter={() => void rename()} />
          : <span className="flex-1">{category.name}</span>}
        {editing?.id === category.id
          ? <Button type="text" size="small" icon={<CheckOutlined />} onClick={() => void rename()} aria-label="Save name" />
          : <Tooltip title="Rename"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditing({ id: category.id, name: category.name })} aria-label={`Rename ${category.name}`} /></Tooltip>}
        {category.builtIn
          ? <span className="categories-builtin">Built-in</span>
          : <Popconfirm title={`Delete “${category.name}”?`} okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => void call('delete-category', category.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${category.name}`} />
          </Popconfirm>}
      </div>)}
    </div>
    <div className="categories-add">
      <Input placeholder="New category" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} onPressEnter={() => void add()} />
      <Button type="primary" icon={<PlusOutlined />} disabled={!name.trim()} onClick={() => void add()}>Add</Button>
    </div>
  </Modal>
}

import { SettingOutlined } from '@ant-design/icons'
import { AutoComplete, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useState } from 'react'
import { CategoryDot } from './charts'
import type { Expense, ExpenseCategory } from './types'

type Values = { amount: number | null; title: string; categoryId: string; spentOn: Dayjs; note: string }
type Suggestion = { title: string; categoryId: string }

const quickAmounts = [10_000, 20_000, 50_000, 100_000, 200_000, 500_000]
const groupDigits = (value: string | number | undefined) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)

export function ExpenseForm({ open, expense, defaultDay, categories, onClose, onSaved, onDeleted, onManageCategories }: {
  open: boolean; expense: Expense | null; defaultDay: string; categories: ExpenseCategory[]
  onClose: () => void; onSaved: (expense: Expense) => void; onDeleted: (id: string) => void; onManageCategories: () => void
}) {
  const [form] = Form.useForm<Values>()
  const [saving, setSaving] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [categoryTouched, setCategoryTouched] = useState(false)
  const categoryId = Form.useWatch('categoryId', form)
  const title = Form.useWatch('title', form) ?? ''

  useEffect(() => {
    if (!open) return
    setCategoryTouched(!!expense)
    form.setFieldsValue(expense
      ? { amount: expense.amount, title: expense.title, categoryId: expense.categoryId, spentOn: dayjs(expense.spentOn), note: expense.note }
      : { amount: null, title: '', categoryId: categories[0]?.id ?? 'other', spentOn: dayjs(defaultDay), note: '' })
    void window.desktop?.modules.invoke<Suggestion[]>('expenses', 'titles').then(setSuggestions).catch(() => undefined)
  }, [open, expense])

  async function submit(again: boolean) {
    let values: Values
    try { values = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      const saved = await window.desktop!.modules.invoke<Expense>('expenses', 'save', {
        ...(expense ? { id: expense.id } : {}),
        amount: values.amount, title: values.title, categoryId: values.categoryId, note: values.note ?? '', spentOn: values.spentOn.format('YYYY-MM-DD')
      })
      onSaved(saved)
      if (again) {
        message.success('Expense added')
        form.setFieldsValue({ amount: null, title: '', note: '' })
        setCategoryTouched(false)
        document.querySelector<HTMLInputElement>('.expense-amount input')?.focus()
      } else onClose()
    } catch (cause) { message.error(errorText(cause)) } finally { setSaving(false) }
  }

  async function remove() {
    if (!expense) return
    try {
      await window.desktop!.modules.invoke('expenses', 'delete', expense.id)
      onDeleted(expense.id)
      onClose()
    } catch (cause) { message.error(errorText(cause)) }
  }

  const query = title.trim().toLowerCase()
  const options = suggestions.filter((item) => query && item.title.toLowerCase().includes(query) && item.title.toLowerCase() !== query).slice(0, 6)
    .map((item) => ({ value: item.title, label: <span className="flex items-center gap-2"><CategoryDot category={categories.find((entry) => entry.id === item.categoryId)} />{item.title}</span> }))

  return <Modal open={open} onCancel={onClose} title={expense ? 'Edit expense' : 'Add expense'} width={520} destroyOnHidden
    footer={<div className="expense-form-footer">
      {expense ? <Popconfirm title="Delete this expense?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => void remove()}><Button danger type="text">Delete</Button></Popconfirm> : <span />}
      <span className="flex gap-2">
        <Button onClick={onClose}>Cancel</Button>
        {!expense && <Button loading={saving} onClick={() => void submit(true)}>Save & add another</Button>}
        <Button type="primary" loading={saving} onClick={() => void submit(false)}>Save</Button>
      </span>
    </div>}>
    <Form form={form} layout="vertical" requiredMark={false} onFinish={() => void submit(false)} className="expense-form">
      <Form.Item name="amount" label="Amount" rules={[{ required: true, message: 'Enter an amount' }, { type: 'number', min: 1, message: 'The amount must be greater than 0' }]} className="mb-2!">
        <InputNumber<number> size="large" autoFocus min={0} max={1_000_000_000_000} precision={0} controls={false} suffix="₫" placeholder="0" className="expense-amount w-full!"
          formatter={groupDigits} parser={(value) => Number((value ?? '').replace(/\D/g, '')) || 0} />
      </Form.Item>
      <div className="expense-quick">{quickAmounts.map((value) => <button key={value} type="button" onClick={() => form.setFieldValue('amount', value)}>{groupDigits(value)}</button>)}</div>
      <div className="grid grid-cols-[1fr_160px] gap-3">
        <Form.Item name="title" label="What was it for?" rules={[{ required: true, whitespace: true, message: 'Describe the expense' }, { max: 120 }]}>
          <AutoComplete options={options} placeholder="e.g. Lunch with the team" maxLength={120}
            onSelect={(value: string) => { const match = suggestions.find((item) => item.title === value); if (match && !categoryTouched) form.setFieldValue('categoryId', match.categoryId) }} />
        </Form.Item>
        <Form.Item name="spentOn" label="Date" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" allowClear={false} className="w-full" /></Form.Item>
      </div>
      <Form.Item name="categoryId" label={<span className="flex w-full items-center justify-between">Category<Button type="link" size="small" icon={<SettingOutlined />} onClick={onManageCategories} className="px-0!">Manage</Button></span>} rules={[{ required: true }]}>
        <div className="expense-categories" role="radiogroup" aria-label="Category">
          {categories.map((category) => <button key={category.id} type="button" role="radio" aria-checked={categoryId === category.id} className={categoryId === category.id ? 'selected' : ''}
            onClick={() => { setCategoryTouched(true); form.setFieldValue('categoryId', category.id) }}>
            <CategoryDot category={category} />{category.name}
          </button>)}
        </div>
      </Form.Item>
      <Form.Item name="note" label="Details (optional)"><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={1000} placeholder="Where, who with, anything to remember" /></Form.Item>
      <button type="submit" hidden />
    </Form>
  </Modal>
}

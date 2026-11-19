import { CheckOutlined, CloseOutlined, DownOutlined } from '@ant-design/icons'
import { Dropdown } from 'antd'

type Option = { value: string; label: string }

type FilterChipProps = {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}

export function FilterChip({ label, value, options, onChange }: FilterChipProps) {
  const active = value !== 'all'
  const selected = options.find((option) => option.value === value)
  const items = options.map((option) => ({
    key: option.value,
    label: option.label,
    icon: option.value === value ? <CheckOutlined /> : <span className="drive-chip-check-space" />
  }))
  return <Dropdown trigger={['click']} menu={{ items, onClick: ({ key }) => onChange(key) }} disabled={options.length === 0}>
    <button type="button" className={`drive-chip ${active ? 'active' : ''}`}>
      {active && <CheckOutlined />}
      <span>{active ? selected?.label ?? value : label}</span>
      {active
        ? <CloseOutlined className="drive-chip-clear" aria-label={`Clear ${label}`} onClick={(event) => { event.stopPropagation(); onChange('all') }} />
        : <DownOutlined />}
    </button>
  </Dropdown>
}

import { ArrowDownOutlined, ArrowUpOutlined, LeftOutlined, MinusOutlined, PlusOutlined, RightOutlined, SearchOutlined, TagsOutlined, WalletOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, Segmented, Select, Tooltip, message } from 'antd'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ModulePage } from '../core/ModulePage'
import type { RendererModule } from '../core/renderer'
import { CategoriesModal } from './CategoriesModal'
import { CategoryBreakdown, CategoryDot, SpendBars, type CategoryTotal } from './charts'
import { ExpenseForm } from './ExpenseForm'
import { buckets, daysIn, formatMoney, fromDay, periodLabel, rangeFor, shift, toDay, type Period } from './period'
import type { Expense, ExpenseCategory } from './types'

const periodKey = 'miniapp-expenses-period'
const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
const invoke = <T,>(action: string, payload?: unknown) => window.desktop!.modules.invoke<T>('expenses', action, payload)

function savedPeriod(): Period {
  try { const value = localStorage.getItem(periodKey); if (value === 'week' || value === 'month' || value === 'year') return value } catch { /* storage unavailable */ }
  return 'month'
}

function dayHeading(day: string): string {
  const date = fromDay(day)
  const now = new Date()
  if (day === toDay(now)) return 'Today'
  if (day === toDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <div className="expense-stat"><span className="expense-stat-label">{label}</span><strong>{value}</strong>{detail && <span className="expense-stat-detail">{detail}</span>}</div>
}

function ExpensesPage() {
  const [period, setPeriod] = useState<Period>(savedPeriod)
  const [anchor, setAnchor] = useState(() => new Date())
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [previousTotal, setPreviousTotal] = useState(0)
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [category, setCategory] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<{ expense: Expense | null } | null>(null)
  const [managing, setManaging] = useState(false)
  const [version, setVersion] = useState(0)

  const today = toDay(new Date())
  const { start, end } = useMemo(() => rangeFor(period, anchor), [period, anchor])
  const startDay = toDay(start)
  const endDay = toDay(end)
  const isCurrent = startDay <= today && today <= endDay
  // Compare like with like: an unfinished period is measured against the same number of days last time.
  const elapsed = isCurrent ? daysIn(start, fromDay(today)) : today < startDay ? 0 : daysIn(start, end)
  const previous = rangeFor(period, shift(period, anchor, -1))
  const previousStart = toDay(previous.start)
  const previousEnd = isCurrent
    ? toDay(new Date(Math.min(previous.end.getTime(), new Date(previous.start.getFullYear(), previous.start.getMonth(), previous.start.getDate() + elapsed - 1).getTime())))
    : toDay(previous.end)

  useEffect(() => { try { localStorage.setItem(periodKey, period) } catch { /* storage unavailable */ } }, [period])

  useEffect(() => {
    if (!window.desktop) return
    void invoke<ExpenseCategory[]>('categories').then(setCategories).catch((cause: unknown) => message.error(errorText(cause)))
  }, [])

  useEffect(() => {
    if (!window.desktop) return
    let active = true
    void Promise.all([
      invoke<Expense[]>('list', { start: startDay, end: endDay }),
      invoke<number>('total', { start: previousStart, end: previousEnd })
    ]).then(([list, before]) => { if (active) { setExpenses(list); setPreviousTotal(before) } })
      .catch((cause: unknown) => { if (active) message.error(errorText(cause)) })
    return () => { active = false }
  }, [startDay, endDay, previousStart, previousEnd, version])

  const byId = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])
  const total = expenses.reduce((sum, item) => sum + item.amount, 0)
  const chartData = useMemo(() => {
    const sums = new Map<string, number>()
    for (const item of expenses) {
      const key = period === 'year' ? item.spentOn.slice(0, 7) : item.spentOn
      sums.set(key, (sums.get(key) ?? 0) + item.amount)
    }
    return buckets(period, start, end).map((bucket) => ({ bucket, total: sums.get(bucket.key) ?? 0 }))
  }, [expenses, period, start, end])
  const categoryTotals = useMemo(() => {
    const sums = new Map<string, CategoryTotal>()
    for (const item of expenses) {
      const entry = byId.get(item.categoryId) ?? byId.get('other')
      if (!entry) continue
      const row = sums.get(entry.id) ?? { category: entry, total: 0, count: 0 }
      row.total += item.amount
      row.count += 1
      sums.set(entry.id, row)
    }
    return [...sums.values()]
  }, [expenses, byId])

  const needle = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const map = new Map<string, Expense[]>()
    for (const item of expenses) {
      if (category && item.categoryId !== category) continue
      if (needle && !`${item.title} ${item.note}`.toLowerCase().includes(needle)) continue
      map.set(item.spentOn, [...(map.get(item.spentOn) ?? []), item])
    }
    return [...map.entries()]
  }, [expenses, category, needle])

  const change = previousTotal > 0 ? (total - previousTotal) / previousTotal : null
  const comparison = isCurrent ? `vs same point last ${period}` : `vs previous ${period}`
  const currentKey = period === 'year' ? today.slice(0, 7) : today
  const refresh = () => setVersion((value) => value + 1)
  const defaultDay = isCurrent ? today : endDay < today ? endDay : startDay
  const label = periodLabel(period, start, end)

  return <ModulePage title="Expenses" description="Record what you spend and see where it goes." icon={<WalletOutlined />}
    actions={<><Button icon={<TagsOutlined />} onClick={() => setManaging(true)} disabled={!window.desktop}>Categories</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ expense: null })} disabled={!window.desktop}>Add expense</Button></>}>
    {!window.desktop && <Alert type="warning" showIcon title="Open the Electron app to track expenses." className="mb-4" />}
    <div className="expense-period">
      <Segmented<Period> value={period} onChange={(value) => { setPeriod(value); setAnchor(new Date()) }} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} />
      <div className="expense-period-nav">
        <Tooltip title={`Previous ${period}`}><Button type="text" icon={<LeftOutlined />} onClick={() => setAnchor(shift(period, anchor, -1))} aria-label={`Previous ${period}`} /></Tooltip>
        <h2>{label}</h2>
        <Tooltip title={`Next ${period}`}><Button type="text" icon={<RightOutlined />} onClick={() => setAnchor(shift(period, anchor, 1))} aria-label={`Next ${period}`} /></Tooltip>
      </div>
      {!isCurrent && <Button size="small" onClick={() => setAnchor(new Date())}>This {period}</Button>}
    </div>

    <div className="expense-stats">
      <Stat label="Total spent" value={formatMoney(total)} detail={label} />
      <Stat label="Transactions" value={expenses.length} detail={`${categoryTotals.length} ${categoryTotals.length === 1 ? 'category' : 'categories'}`} />
      <Stat label="Daily average" value={formatMoney(elapsed ? Math.round(total / elapsed) : 0)} detail={elapsed ? `over ${elapsed} ${elapsed === 1 ? 'day' : 'days'}` : 'This period has not started'} />
      <Stat label="Change" detail={change === null ? 'Nothing to compare yet' : `${comparison} (${formatMoney(previousTotal)})`}
        value={change === null ? '—' : <span className="expense-change">{change > 0 ? <ArrowUpOutlined /> : change < 0 ? <ArrowDownOutlined /> : <MinusOutlined />}{`${change > 0 ? '+' : ''}${Math.round(change * 100)}%`}</span>} />
    </div>

    <div className="expense-charts">
      <Card className="settings-card expense-card" title={`Spending by ${period === 'year' ? 'month' : 'day'}`}>
        <SpendBars period={period} data={chartData} currentKey={currentKey} />
      </Card>
      <Card className="settings-card expense-card" title="By category" extra={category && <Button type="link" size="small" onClick={() => setCategory(null)}>Show all</Button>}>
        <CategoryBreakdown rows={categoryTotals} total={total} selected={category} onSelect={setCategory} />
      </Card>
    </div>

    <Card className="settings-card expense-card" title={`Transactions${category ? ` · ${byId.get(category)?.name ?? ''}` : ''}`}
      extra={<div className="expense-filters">
        <Select allowClear placeholder="All categories" value={category ?? undefined} onChange={(value?: string) => setCategory(value ?? null)} className="w-44"
          options={categories.map((item) => ({ value: item.id, label: <span className="flex items-center gap-2"><CategoryDot category={item} />{item.name}</span> }))} />
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} className="w-48" aria-label="Search transactions" />
      </div>}>
      {groups.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={expenses.length ? 'No transactions match' : `Nothing recorded this ${period}`}>
          {!expenses.length && window.desktop && <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ expense: null })}>Add expense</Button>}
        </Empty>
        : <div className="expense-days">{groups.map(([day, items]) => <section key={day} className="expense-day">
          <header><span>{dayHeading(day)}</span><span>{formatMoney(items.reduce((sum, item) => sum + item.amount, 0))}</span></header>
          {items.map((item) => {
            const entry = byId.get(item.categoryId)
            return <button key={item.id} type="button" className="expense-row" onClick={() => setForm({ expense: item })} aria-label={`Edit ${item.title}, ${formatMoney(item.amount)}`}>
              <CategoryDot category={entry} />
              <span className="expense-row-copy"><strong>{item.title}</strong><span>{entry?.name ?? 'Other'}{item.note ? ` · ${item.note}` : ''}</span></span>
              <span className="expense-row-amount">{formatMoney(item.amount)}</span>
            </button>
          })}
        </section>)}</div>}
    </Card>

    <ExpenseForm open={!!form} expense={form?.expense ?? null} defaultDay={defaultDay} categories={categories} onClose={() => setForm(null)}
      onSaved={refresh} onDeleted={refresh} onManageCategories={() => setManaging(true)} />
    <CategoriesModal open={managing} categories={categories} onClose={() => setManaging(false)} onChanged={(list) => { setCategories(list); refresh() }} />
  </ModulePage>
}

export const expensesRendererModule: RendererModule = {
  id: 'expenses',
  label: 'Expenses',
  icon: <WalletOutlined />,
  element: <ExpensesPage />
}

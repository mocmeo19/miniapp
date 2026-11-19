import { Empty, Tooltip } from 'antd'
import type { Bucket, Period } from './period'
import { formatCompact, formatMoney } from './period'
import type { ExpenseCategory } from './types'

export function CategoryDot({ category }: { category?: ExpenseCategory }) {
  return <span className="expense-dot" style={{ background: `var(--series-${category?.color ?? 0})` }} aria-hidden />
}

function niceMax(value: number): number {
  if (value <= 0) return 100_000
  const scale = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((item) => value / scale <= item) ?? 10
  return step * scale
}

/** Spending per day (week, month) or per month (year): a single series, so no legend. */
export function SpendBars({ period, data, currentKey }: { period: Period; data: { bucket: Bucket; total: number }[]; currentKey: string }) {
  const max = niceMax(Math.max(0, ...data.map((item) => item.total)))
  const ticks = [0, max / 2, max]
  const showLabel = (index: number) => period !== 'month' || index === 0 || (index + 1) % 5 === 0
  return <div className="spend-chart">
    <div className="spend-plot">
      <div className="spend-grid" aria-hidden>
        {ticks.map((tick) => <div key={tick} className="spend-gridline" style={{ bottom: `${(tick / max) * 100}%` }}><span>{tick === 0 ? '0' : formatCompact(tick)}</span></div>)}
      </div>
      <div className="spend-bars">
        {data.map(({ bucket, total }) => <Tooltip key={bucket.key} mouseEnterDelay={0} title={<div className="spend-tip"><span>{bucket.title}</span><strong>{formatMoney(total)}</strong></div>}>
          <div className={`spend-col${bucket.key === currentKey ? ' current' : ''}`} tabIndex={0} role="img" aria-label={`${bucket.title}: ${formatMoney(total)}`}>
            {total > 0 && <div className="spend-bar" style={{ height: `${Math.max(1.5, (total / max) * 100)}%` }} />}
          </div>
        </Tooltip>)}
      </div>
    </div>
    <div className="spend-labels" aria-hidden>
      {data.map(({ bucket }, index) => <span key={bucket.key} className={bucket.key === currentKey ? 'current' : ''}>{showLabel(index) ? bucket.label : ''}</span>)}
    </div>
  </div>
}

export type CategoryTotal = { category: ExpenseCategory; total: number; count: number }

/** Share of spending per category. Rows past the eighth fold into one gray row. */
export function CategoryBreakdown({ rows, total, onSelect, selected }: { rows: CategoryTotal[]; total: number; onSelect: (id: string | null) => void; selected: string | null }) {
  if (rows.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No spending in this period" />
  const sorted = [...rows].sort((a, b) => b.total - a.total)
  const shown = sorted.length > 8 ? sorted.slice(0, 7) : sorted
  const rest = sorted.slice(shown.length)
  const restTotal = rest.reduce((sum, item) => sum + item.total, 0)
  const top = sorted[0].total
  return <div className="category-breakdown">
    {shown.map(({ category, total: amount, count }) => {
      const active = selected === category.id
      return <button key={category.id} type="button" className={`category-row${active ? ' active' : ''}${selected && !active ? ' dimmed' : ''}`} aria-pressed={active} onClick={() => onSelect(active ? null : category.id)}>
        <span className="category-row-head">
          <CategoryDot category={category} />
          <span className="category-row-name">{category.name}</span>
          <span className="category-row-amount">{formatMoney(amount)}</span>
          <span className="category-row-share">{Math.round((amount / total) * 100)}%</span>
        </span>
        <span className="category-row-track" aria-hidden><span style={{ width: `${(amount / top) * 100}%`, background: `var(--series-${category.color})` }} /></span>
        <span className="visually-hidden">{count} transactions</span>
      </button>
    })}
    {rest.length > 0 && <div className="category-row">
      <span className="category-row-head"><span className="expense-dot" style={{ background: 'var(--series-0)' }} aria-hidden /><span className="category-row-name">{rest.length} more categories</span><span className="category-row-amount">{formatMoney(restTotal)}</span><span className="category-row-share">{Math.round((restTotal / total) * 100)}%</span></span>
      <span className="category-row-track" aria-hidden><span style={{ width: `${(restTotal / top) * 100}%`, background: 'var(--series-0)' }} /></span>
    </div>}
  </div>
}

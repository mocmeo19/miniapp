export type Period = 'week' | 'month' | 'year'
export type Bucket = { key: string; label: string; title: string; start: string; end: string }

const pad = (value: number) => String(value).padStart(2, '0')

/** Local calendar day as YYYY-MM-DD. */
export const toDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export function fromDay(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

/** Weeks start on Monday. */
export function rangeFor(period: Period, anchor: Date): { start: Date; end: Date } {
  if (period === 'week') {
    const start = addDays(anchor, -((anchor.getDay() + 6) % 7))
    return { start, end: addDays(start, 6) }
  }
  if (period === 'month') return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) }
  return { start: new Date(anchor.getFullYear(), 0, 1), end: new Date(anchor.getFullYear(), 11, 31) }
}

export function shift(period: Period, anchor: Date, steps: number): Date {
  if (period === 'week') return addDays(anchor, steps * 7)
  if (period === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + steps, 1)
  return new Date(anchor.getFullYear() + steps, 0, 1)
}

export function daysIn(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
}

export function buckets(period: Period, start: Date, end: Date): Bucket[] {
  if (period === 'year') {
    return Array.from({ length: 12 }, (_, month) => {
      const first = new Date(start.getFullYear(), month, 1)
      return {
        key: `${first.getFullYear()}-${pad(month + 1)}`,
        label: first.toLocaleDateString([], { month: 'short' }),
        title: first.toLocaleDateString([], { month: 'long', year: 'numeric' }),
        start: toDay(first), end: toDay(new Date(first.getFullYear(), month + 1, 0))
      }
    })
  }
  return Array.from({ length: daysIn(start, end) }, (_, index) => {
    const date = addDays(start, index)
    const day = toDay(date)
    return {
      key: day,
      label: period === 'week' ? date.toLocaleDateString([], { weekday: 'short' }) : String(date.getDate()),
      title: date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }),
      start: day, end: day
    }
  })
}

export function periodLabel(period: Period, start: Date, end: Date): string {
  if (period === 'year') return String(start.getFullYear())
  if (period === 'month') return start.toLocaleDateString([], { month: 'long', year: 'numeric' })
  const sameMonth = start.getMonth() === end.getMonth()
  const from = start.toLocaleDateString([], sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  return `${from} – ${end.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
}

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })

export const formatMoney = (amount: number) => money.format(amount)
export const formatCompact = (amount: number) => compact.format(amount)

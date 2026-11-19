import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MainModule } from '../core/main'
import type { DateRange, Expense, ExpenseCategory } from './types'

type ExpenseRow = { id: string; amount: number; title: string; category_id: string; note: string; spent_on: string; created_at: number }
type CategoryRow = { id: string; name: string; color: number; built_in: number }

const defaultCategories: [string, string][] = [
  ['food', 'Food & drinks'], ['transport', 'Transport'], ['shopping', 'Shopping'], ['bills', 'Bills & utilities'],
  ['entertainment', 'Entertainment'], ['health', 'Health'], ['education', 'Education'], ['home', 'Home']
]
const fallbackCategory = 'other'
const day = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/
const maxAmount = 1_000_000_000_000

function requireDay(value: unknown, label: string): string {
  if (typeof value !== 'string' || !day.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function requireRange(value: unknown): DateRange {
  const range = value as Partial<DateRange> | null
  const start = requireDay(range?.start, 'start date')
  const end = requireDay(range?.end, 'end date')
  if (start > end) throw new Error('The start date is after the end date')
  return { start, end }
}

const expense = (row: ExpenseRow): Expense => ({ id: row.id, amount: row.amount, title: row.title, categoryId: row.category_id, note: row.note, spentOn: row.spent_on, createdAt: row.created_at })
const category = (row: CategoryRow): ExpenseCategory => ({ id: row.id, name: row.name, color: row.color, builtIn: row.built_in === 1 })

export const expensesMainModule: MainModule = {
  id: 'expenses',
  register({ handle, paths }) {
    let db: DatabaseSync | null = null
    let dbPath = ''

    // The data folder can change while the app runs, so the database follows it.
    function database(): DatabaseSync {
      const path = join(paths.data(), 'expenses.db')
      if (db && path === dbPath) return db
      db?.close()
      db = new DatabaseSync(path)
      dbPath = path
      db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color INTEGER NOT NULL DEFAULT 0,
          built_in INTEGER NOT NULL DEFAULT 0,
          sort INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY,
          amount INTEGER NOT NULL CHECK (amount > 0),
          title TEXT NOT NULL,
          category_id TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          spent_on TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS expenses_day ON expenses(spent_on);
      `)
      const insert = db.prepare('INSERT OR IGNORE INTO categories (id, name, color, built_in, sort) VALUES (?, ?, ?, 1, ?)')
      defaultCategories.forEach(([id, name], index) => insert.run(id, name, index + 1, index))
      insert.run(fallbackCategory, 'Other', 0, 1000)
      return db
    }

    function categories(): ExpenseCategory[] {
      return (database().prepare('SELECT id, name, color, built_in FROM categories ORDER BY sort, rowid').all() as CategoryRow[]).map(category)
    }

    function total(range: DateRange): number {
      const row = database().prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE spent_on BETWEEN ? AND ?').get(range.start, range.end) as { total: number }
      return row.total
    }

    handle('categories', () => categories())
    handle('save-category', (_event, value) => {
      const input = value as { id?: unknown; name?: unknown } | null
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      if (!name || name.length > 40) throw new Error('Enter a category name (1–40 characters)')
      const list = categories()
      if (list.some((item) => item.name.toLowerCase() === name.toLowerCase() && item.id !== input?.id)) throw new Error('A category with this name already exists')
      if (typeof input?.id === 'string') {
        if (!list.some((item) => item.id === input.id)) throw new Error('Category not found')
        database().prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, input.id)
      } else {
        if (list.length >= 40) throw new Error('Category limit reached')
        // New categories take the next free palette slot; once all eight are used they stay gray.
        const used = new Set(list.map((item) => item.color))
        const color = [1, 2, 3, 4, 5, 6, 7, 8].find((slot) => !used.has(slot)) ?? 0
        const sort = list.filter((item) => item.id !== fallbackCategory).length
        database().prepare('INSERT INTO categories (id, name, color, built_in, sort) VALUES (?, ?, ?, 0, ?)').run(randomUUID(), name, color, sort)
      }
      return categories()
    })
    handle('delete-category', (_event, value) => {
      const target = categories().find((item) => item.id === value)
      if (!target) throw new Error('Category not found')
      if (target.builtIn) throw new Error('Built-in categories cannot be deleted')
      // Spending in a deleted category moves to "Other" so totals stay correct.
      database().prepare('UPDATE expenses SET category_id = ? WHERE category_id = ?').run(fallbackCategory, target.id)
      database().prepare('DELETE FROM categories WHERE id = ?').run(target.id)
      return categories()
    })

    handle('list', (_event, value) => {
      const range = requireRange(value)
      return (database().prepare('SELECT * FROM expenses WHERE spent_on BETWEEN ? AND ? ORDER BY spent_on DESC, created_at DESC').all(range.start, range.end) as ExpenseRow[]).map(expense)
    })
    handle('total', (_event, value) => total(requireRange(value)))
    handle('save', (_event, value) => {
      if (!value || typeof value !== 'object') throw new Error('Invalid expense')
      const input = value as Record<string, unknown>
      const amount = typeof input.amount === 'number' ? Math.round(input.amount) : NaN
      if (!Number.isFinite(amount) || amount <= 0 || amount > maxAmount) throw new Error('Enter an amount greater than 0')
      const title = typeof input.title === 'string' ? input.title.trim() : ''
      if (!title || title.length > 120) throw new Error('Enter what the money was spent on (1–120 characters)')
      const note = typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : ''
      const spentOn = requireDay(input.spentOn, 'date')
      const categoryId = categories().some((item) => item.id === input.categoryId) ? input.categoryId as string : fallbackCategory
      if (typeof input.id === 'string') {
        if (!uuid.test(input.id)) throw new Error('Invalid expense')
        const result = database().prepare('UPDATE expenses SET amount = ?, title = ?, category_id = ?, note = ?, spent_on = ? WHERE id = ?').run(amount, title, categoryId, note, spentOn, input.id)
        if (result.changes === 0) throw new Error('Expense not found')
        return expense(database().prepare('SELECT * FROM expenses WHERE id = ?').get(input.id) as ExpenseRow)
      }
      const id = randomUUID()
      database().prepare('INSERT INTO expenses (id, amount, title, category_id, note, spent_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, amount, title, categoryId, note, spentOn, Date.now())
      return expense(database().prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow)
    })
    handle('delete', (_event, value) => {
      if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Invalid expense')
      database().prepare('DELETE FROM expenses WHERE id = ?').run(value)
    })
    handle('titles', () => (database().prepare(`SELECT title, category_id AS categoryId, COUNT(*) AS uses FROM expenses
      GROUP BY title ORDER BY uses DESC, MAX(created_at) DESC LIMIT 50`).all() as { title: string; categoryId: string }[]))

    return () => { db?.close(); db = null }
  }
}

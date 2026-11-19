export type ExpenseCategory = {
  id: string
  name: string
  /** Categorical palette slot 1–8; 0 is the neutral gray kept for "Other" and extra categories. */
  color: number
  /** Built-in categories cannot be deleted. */
  builtIn: boolean
}

export type Expense = {
  id: string
  /** Whole đồng. */
  amount: number
  title: string
  categoryId: string
  note: string
  /** Local calendar day, YYYY-MM-DD. */
  spentOn: string
  createdAt: number
}

export type ExpenseInput = Omit<Expense, 'id' | 'createdAt'> & { id?: string }

export type DateRange = { start: string; end: string }

import type { ReactNode } from 'react'

type ModulePageProps = {
  title: string
  description: string
  icon?: ReactNode
  /** Optional controls shown after the icon, at the right end of the header. */
  actions?: ReactNode
  /** Fill the viewport height instead of scrolling (for pages that host a native view). */
  fill?: boolean
  children: ReactNode
}

// Shared page frame for modules: one header, one width and one spacing rule.
export function ModulePage({ title, description, icon, actions, fill, children }: ModulePageProps) {
  return <div className={`module-page${fill ? ' module-page-fill' : ''}`}>
    <header className="module-header">
      <div><h1>{title}</h1><p>{description}</p></div>
      {(icon || actions) && <div className="module-header-side">{icon && <div className="module-icon">{icon}</div>}{actions}</div>}
    </header>
    {children}
  </div>
}

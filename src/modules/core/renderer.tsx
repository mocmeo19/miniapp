import type { ReactNode } from 'react'

export type RendererModule = {
  id: string
  label: string
  icon: ReactNode
  element: ReactNode
  settings?: ReactNode
}

const modules: RendererModule[] = []

// The shell reads this registry to attach navigation and routes.
export function loadModule(module: RendererModule): void {
  if (!/^[a-z][a-z0-9-]*$/.test(module.id) || modules.some((item) => item.id === module.id)) {
    throw new Error(`Invalid or duplicate module id: ${module.id}`)
  }
  modules.push(module)
}

export function getModules(): readonly RendererModule[] {
  return modules
}

export function modulePath(id: string): string {
  return `/modules/${id}`
}

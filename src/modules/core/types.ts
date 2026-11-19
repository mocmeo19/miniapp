export type InstalledModule = {
  id: string
  name: string
  version: string
  description: string
  source: 'built-in' | 'file' | 'url'
  enabled: boolean
}

export type CatalogEntry = {
  id: string
  name: string
  version: string
  description: string
  downloadUrl: string
}

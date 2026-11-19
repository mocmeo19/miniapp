import type { DeviceInfo } from './types'

function formatKb(kb: number): string {
  return kb >= 1048576 ? `${(kb / 1048576).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`
}

// Parses the combined output of the single adb shell call made by the `info` handler.
export function parseInfo(output: string): DeviceInfo {
  const [props = '', battery = '', display = '', memory = '', disk = '', network = ''] = output.split('@@@\n')
  const prop: Record<string, string> = {}
  for (const match of props.matchAll(/^\[([^\]]+)\]: \[(.*)\]$/gm)) prop[match[1]] = match[2]
  const field = (text: string, pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? ''
  const rows = (entries: [string, string][]) => entries.filter(([, value]) => value) as [string, string][]
  const memTotal = Number(field(memory, /MemTotal:\s*(\d+)/))
  const memFree = Number(field(memory, /MemAvailable:\s*(\d+)/))
  const df = disk.trim().split('\n').pop()?.trim().split(/\s+/) ?? []
  const level = field(battery, /level:\s*(\d+)/)
  const temperature = Number(field(battery, /temperature:\s*(-?\d+)/))
  const charging = /(?:AC|USB|Wireless) powered:\s*true/.test(battery) ? 'charging' : 'on battery'
  return { sections: [
    { title: 'Device', rows: rows([
      ['Manufacturer', prop['ro.product.manufacturer'] ?? ''], ['Model', prop['ro.product.model'] ?? ''],
      ['Device name', prop['ro.product.device'] ?? ''], ['Brand', prop['ro.product.brand'] ?? ''],
      ['Serial number', prop['ro.serialno'] ?? ''], ['Hardware', prop['ro.hardware'] ?? ''],
      ['Platform', prop['ro.board.platform'] ?? ''], ['CPU ABI', prop['ro.product.cpu.abi'] ?? '']
    ]) },
    { title: 'Software', rows: rows([
      ['Android', prop['ro.build.version.release'] ?? ''], ['API level', prop['ro.build.version.sdk'] ?? ''],
      ['Security patch', prop['ro.build.version.security_patch'] ?? ''], ['Build', prop['ro.build.display.id'] ?? ''],
      ['Build type', prop['ro.build.type'] ?? ''], ['Language', prop['persist.sys.locale'] || prop['ro.product.locale'] || ''],
      ['Timezone', prop['persist.sys.timezone'] ?? '']
    ]) },
    { title: 'Display', rows: rows([
      ['Resolution', field(display, /Physical size:\s*(\S+)/)], ['Override size', field(display, /Override size:\s*(\S+)/)],
      ['Density', field(display, /Physical density:\s*(\d+)/) && `${field(display, /Physical density:\s*(\d+)/)} dpi`]
    ]) },
    { title: 'Battery', rows: rows([
      ['Level', level && `${level}%`], ['Status', level ? charging : ''],
      ['Temperature', Number.isFinite(temperature) && temperature ? `${(temperature / 10).toFixed(1)} °C` : ''],
      ['Health code', field(battery, /health:\s*(\d+)/)]
    ]) },
    { title: 'Memory & storage', rows: rows([
      ['RAM total', memTotal ? formatKb(memTotal) : ''], ['RAM available', memFree ? formatKb(memFree) : ''],
      ['Data size', df[1] && /^\d+$/.test(df[1]) ? formatKb(Number(df[1])) : ''], ['Data used', df[2] && /^\d+$/.test(df[2]) ? formatKb(Number(df[2])) : ''],
      ['Data free', df[3] && /^\d+$/.test(df[3]) ? formatKb(Number(df[3])) : '']
    ]) },
    { title: 'Network', rows: rows([
      ['Wi-Fi IP', field(network, /inet\s+(\d+\.\d+\.\d+\.\d+)/)], ['Wi-Fi MAC', field(network, /link\/ether\s+([\da-f:]+)/i)]
    ]) }
  ].filter((section) => section.rows.length > 0) }
}

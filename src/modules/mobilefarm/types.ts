export type FarmDevice = {
  serial: string
  state: string
  model: string
  mirroring: boolean
}

export type MirrorOptions = {
  maxSize: number
  bitrate: number
  maxFps: number
  viewOnly: boolean
  stayAwake: boolean
}

export type FarmStatus = {
  adb: string | null
  /** Path of the scrcpy-server the app streams from (bundled by `npm run setup:media`). */
  server: string | null
  devices: FarmDevice[]
  options: MirrorOptions
}

export type DeviceInfo = {
  sections: { title: string; rows: [label: string, value: string][] }[]
}

/** A device shown in the mirror wall window. */
export type WallDevice = { serial: string; model: string }

export const wallColumns = 4
export const wallRows = 2
export const wallCapacity = wallColumns * wallRows

/** Video stream messages from the main process to the mirror wall window. */
export type VideoMessage =
  | { serial: string; kind: 'session'; width: number; height: number }
  | { serial: string; kind: 'config'; data: Uint8Array }
  | { serial: string; kind: 'frame'; data: Uint8Array; key: boolean; pts: number }
  | { serial: string; kind: 'closed'; reason: string }

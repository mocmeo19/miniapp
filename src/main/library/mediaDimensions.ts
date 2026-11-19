import { spawn } from 'node:child_process'
import { imageSizeFromFile } from 'image-size/fromFile'

export type Dimensions = { width: number; height: number }

/** Stored for files whose size cannot be read, so they are not retried on every scan. */
export const unreadable: Dimensions = { width: 0, height: 0 }

// EXIF orientations 5–8 rotate the picture by 90°, so the displayed width and height swap.
const swapsAxes = (orientation?: number) => orientation !== undefined && orientation >= 5 && orientation <= 8

export async function imageDimensions(path: string): Promise<Dimensions> {
  try {
    const size = await imageSizeFromFile(path)
    if (!size.width || !size.height) return unreadable
    return swapsAxes(size.orientation) ? { width: size.height, height: size.width } : { width: size.width, height: size.height }
  } catch {
    return unreadable
  }
}

/** Reads the first video stream's display size from ffmpeg's stream summary. */
export function videoDimensions(ffmpeg: string, path: string): Promise<Dimensions> {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(ffmpeg, ['-hide_banner', '-i', path], { windowsHide: true })
    const timer = setTimeout(() => child.kill(), 15000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { output = (output + chunk).slice(-40000) })
    child.once('error', () => { clearTimeout(timer); resolve(unreadable) })
    child.once('close', () => {
      clearTimeout(timer)
      const size = /Stream #\d+:\d+.*?: Video: .*?(\d{2,5})x(\d{2,5})/.exec(output)
      if (!size) return resolve(unreadable)
      const width = Number(size[1])
      const height = Number(size[2])
      const rotation = Number(/rotation of (-?[\d.]+) degrees/.exec(output)?.[1] ?? /rotate\s*:\s*(-?\d+)/.exec(output)?.[1] ?? 0)
      resolve(Math.abs(Math.round(rotation)) % 180 === 90 ? { width: height, height: width } : { width, height })
    })
  })
}

import { nativeImage, type NativeImage } from 'electron'

export const inputSize = 224
const resizeEdge = 256
const thumbnailBound = 512

/** `center-crop`: shortest edge to 256, then the middle 224×224. `stretch`: the whole image squeezed to 224×224. */
export type Preprocess = 'center-crop' | 'stretch'

export async function loadImage(path: string): Promise<NativeImage> {
  const image = process.platform === 'linux'
    ? nativeImage.createFromPath(path)
    : await nativeImage.createThumbnailFromPath(path, { width: thumbnailBound, height: thumbnailBound })
  if (image.isEmpty()) throw new Error('Unsupported image')
  return image
}

function resizeFor(source: NativeImage, preprocess: Preprocess): NativeImage {
  if (preprocess === 'stretch') return source.resize({ width: inputSize, height: inputSize, quality: 'good' })
  const { width, height } = source.getSize()
  const scale = resizeEdge / Math.min(width, height)
  const resized = source.resize({
    width: Math.max(inputSize, Math.round(width * scale)),
    height: Math.max(inputSize, Math.round(height * scale)),
    quality: 'good'
  })
  const size = resized.getSize()
  return resized.crop({ x: Math.floor((size.width - inputSize) / 2), y: Math.floor((size.height - inputSize) / 2), width: inputSize, height: inputSize })
}

/** RGB normalized to [-1, 1] in CHW order, as both bundled models expect. */
export function tensorFrom(source: NativeImage, preprocess: Preprocess): Float32Array {
  // toBitmap returns BGRA bytes.
  const bitmap = resizeFor(source, preprocess).toBitmap()
  const plane = inputSize * inputSize
  if (bitmap.length !== plane * 4) throw new Error('Unexpected image data')
  const data = new Float32Array(plane * 3)
  for (let pixel = 0; pixel < plane; pixel++) {
    data[pixel] = bitmap[pixel * 4 + 2] / 127.5 - 1
    data[plane + pixel] = bitmap[pixel * 4 + 1] / 127.5 - 1
    data[plane * 2 + pixel] = bitmap[pixel * 4] / 127.5 - 1
  }
  return data
}

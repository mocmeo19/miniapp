import type { NativeImage } from 'electron'
import * as ort from 'onnxruntime-node'
import { inputSize, tensorFrom, type Preprocess } from './imageTensor'

export class ImageClassifier {
  private constructor(private readonly session: ort.InferenceSession, private readonly preprocess: Preprocess) {}

  static async load(modelPath: string, preprocess: Preprocess): Promise<ImageClassifier> {
    return new ImageClassifier(await ort.InferenceSession.create(modelPath, { intraOpNumThreads: 2 }), preprocess)
  }

  /** Softmax over the model's classes, in the model's label order. */
  async probabilities(image: NativeImage): Promise<Float32Array> {
    const input = new ort.Tensor('float32', tensorFrom(image, this.preprocess), [1, 3, inputSize, inputSize])
    const output = await this.session.run({ [this.session.inputNames[0]]: input })
    const logits = output[this.session.outputNames[0]].data as Float32Array
    let max = -Infinity
    for (const value of logits) max = Math.max(max, value)
    const result = new Float32Array(logits.length)
    let sum = 0
    for (let index = 0; index < logits.length; index++) { result[index] = Math.exp(logits[index] - max); sum += result[index] }
    for (let index = 0; index < result.length; index++) result[index] /= sum
    return result
  }

  async dispose(): Promise<void> { await this.session.release() }
}

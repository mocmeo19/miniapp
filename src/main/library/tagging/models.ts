import type { AutoTagModel } from '../../../library/types'
import type { Preprocess } from './imageTensor'
import { nsfwTagNames, nsfwTags } from './nsfwRules'
import { tagsFromProbabilities } from './tagRules'

export type ModelSpec = AutoTagModel & {
  /** Changes whenever the model or its tag rules change, so images are tagged again. */
  version: string
  url: string
  sha256: string
  preprocess: Preprocess
  tags: (probabilities: Float32Array) => string[]
}

export const modelSpecs: ModelSpec[] = [
  {
    id: 'mobilenet_v2_1.0_224',
    name: 'General objects',
    description: 'Recognizes about 1,000 everyday objects, animals and scenes (MobileNetV2, ImageNet).',
    tagExamples: ['dog', 'cat', 'bird', 'laptop', 'seashore'],
    size: 14002696,
    license: 'Apache-2.0',
    version: 'mobilenet_v2_1.0_224@c5903ea',
    url: 'https://huggingface.co/onnx-community/mobilenet_v2_1.0_224/resolve/c5903ea5f5bb219f02c85a778af0fedf14f502d8/onnx/model.onnx',
    sha256: 'a86af476bbfa58ec86cae5f17d3d17d88c3c2b489e8ae2bd7e02421257f14dc2',
    preprocess: 'center-crop',
    tags: tagsFromProbabilities
  },
  {
    id: 'nsfw_vit_5',
    name: 'Sensitive content',
    description: 'Sorts photos into neutral, drawing, hentai, nude or sexy, and adds 18+ to adult content (ViT, quantized).',
    tagExamples: nsfwTagNames,
    size: 87348425,
    license: 'Apache-2.0 (base model)',
    version: 'nsfw_vit_5@6626deb',
    url: 'https://huggingface.co/onnx-community/nsfw-image-detector-ONNX/resolve/6626debca038a8f7aa1729b1eaee3bd4eb929ad6/onnx/model_quantized.onnx',
    sha256: '10354606f3442d24308c0a37d1fd6205ab7ce7bf31669e186a4fc5cf7f51b455',
    preprocess: 'stretch',
    tags: nsfwTags
  }
]

export const defaultModelIds = [modelSpecs[0].id]

export function specsFor(ids: string[]): ModelSpec[] {
  const chosen = modelSpecs.filter((spec) => ids.includes(spec.id))
  return chosen.length ? chosen : modelSpecs.filter((spec) => defaultModelIds.includes(spec.id))
}

/** One string per model combination; images tagged with another combination are tagged again. */
export function modelVersion(specs: ModelSpec[]): string {
  return specs.map((spec) => spec.version).sort().join('+')
}

import labels from './imagenet-labels.json'

const maxLabels = 3
const minLabelScore = 0.2
const minGroupScore = 0.4

// Index ranges in the 1001-class MobileNet output (index 0 is "background").
const groups: Array<{ tag: string; ranges: Array<[number, number]> }> = [
  { tag: 'dog', ranges: [[152, 269]] },
  { tag: 'cat', ranges: [[282, 286]] },
  { tag: 'bird', ranges: [[8, 25], [81, 101], [128, 147]] }
]

export function tagsFromProbabilities(probabilities: Float32Array): string[] {
  const tags = new Set<string>()
  for (const group of groups) {
    let score = 0
    for (const [from, to] of group.ranges) for (let index = from; index <= to; index++) score += probabilities[index] ?? 0
    if (score >= minGroupScore) tags.add(group.tag)
  }
  const ranked = Array.from(probabilities, (score, index) => ({ index, score }))
    .filter((item) => item.index > 0 && item.score >= minLabelScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLabels)
  for (const item of ranked) {
    const label = (labels as string[])[item.index]
    if (label) tags.add(label)
  }
  return [...tags]
}

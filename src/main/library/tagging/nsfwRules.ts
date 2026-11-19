// Output order of the sensitive-content classifier: drawings, hentai, neutral, porn, sexy.
const tagForClass = ['drawing', 'hentai', 'neutral', 'nude', 'sexy']
const minClassScore = 0.5
const adultClasses = [1, 3, 4]
const minAdultScore = 0.6

export const nsfwTagNames = [...tagForClass, '18+']

export function nsfwTags(probabilities: Float32Array): string[] {
  const tags: string[] = []
  let best = 0
  for (let index = 1; index < tagForClass.length; index++) if (probabilities[index] > probabilities[best]) best = index
  if (probabilities[best] >= minClassScore) tags.push(tagForClass[best])
  const adult = adultClasses.reduce((sum, index) => sum + (probabilities[index] ?? 0), 0)
  if (adult >= minAdultScore) tags.push('18+')
  return tags
}

// Steps that must not make a request, and whether they did.
//
// A step that only opens a panel is not the user asking for anything to be
// downloaded: the Lottie tab must sit on its "Browse LottieFiles" button until
// that button is clicked. The network check records requests per step, so the
// rule is decided here rather than inferred from an origin list: even a request
// to the app's own origin is an unexpected one.

/**
 * Report the steps marked `noRequests` that made at least one request.
 *
 * @param {Array<{ name: string, noRequests?: boolean }>} steps
 * @param {Array<{ step: string, url: string }>} entries every recorded request
 * @returns {Array<{ step: string, count: number, urls: string[] }>}
 */
export function findUnexpectedRequests(steps, entries) {
  const byStep = new Map()
  for (const entry of entries) {
    const urls = byStep.get(entry.step)
    if (urls) {
      urls.push(entry.url)
    } else {
      byStep.set(entry.step, [entry.url])
    }
  }

  const unexpected = []
  for (const step of steps) {
    if (!step.noRequests) continue
    const urls = byStep.get(step.name)
    if (urls && urls.length > 0) {
      unexpected.push({ step: step.name, count: urls.length, urls })
    }
  }
  return unexpected
}

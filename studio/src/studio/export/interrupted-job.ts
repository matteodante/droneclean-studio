// A render job the page lost: one that `render-queue.json` still holds as "rendering" when the queue loads. Its page
// went away while it rendered (a crash, a reload, a quit), so it has no file and nothing is rendering it any more.
// FreeCut put such a job back in the queue and paused the queue, which left it there for good when nobody resumes
// it: an agent's next export of the project was refused as "already queued", one export at a time (19 Nov 2026, the
// MCP tour). It is failed instead, with an error that says what happened; the queue panel's Retry renders it again.

/** The error of a job the page lost while it rendered */
export const INTERRUPTED_JOB_ERROR =
  'interrupted: the app or its editor page stopped while this job was rendering (a crash, a reload or a quit), ' +
  'so it wrote no file; start the export again'

/** The fields of a job this decides on, as the render queue persists them */
interface RestorableJob {
  readonly status: string
  readonly error?: string
}

/** The job as the queue restores it: a "rendering" one failed as interrupted, any other unchanged */
export function failInterruptedJob<T extends RestorableJob>(job: T): T {
  if (job.status !== 'rendering') return job
  return { ...job, status: 'failed', error: INTERRUPTED_JOB_ERROR }
}

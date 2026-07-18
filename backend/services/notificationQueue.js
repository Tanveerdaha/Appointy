/**
 * Lightweight in-process notification retry queue.
 * Booking must not fail when email/SMS delivery fails — jobs are queued after commit
 * and retried asynchronously.
 */

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 500

/** @type {Map<string, object>} */
const jobs = new Map()
let jobCounter = 0
let processing = false

const logQueue = (level, message, meta = {}) => {
  const entry = {
    scope: 'notification_queue',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Enqueue a notification job. Returns immediately; delivery runs in the background.
 *
 * @param {object} args
 * @param {string} args.type
 * @param {Function} args.handler Async function that performs the side effect
 * @param {object} [args.meta] Non-sensitive metadata for logs
 * @param {number} [args.maxAttempts]
 * @returns {{ jobId: string }}
 */
export const enqueueNotification = ({
  type,
  handler,
  meta = {},
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) => {
  jobCounter += 1
  const jobId = `notif_${Date.now()}_${jobCounter}`
  jobs.set(jobId, {
    jobId,
    type,
    handler,
    meta,
    maxAttempts,
    attempts: 0,
    status: 'queued',
    lastError: null,
  })

  logQueue('info', 'Notification queued', { jobId, type, ...meta })
  scheduleProcess()
  return { jobId }
}

const scheduleProcess = () => {
  if (processing) return
  processing = true
  setImmediate(() => {
    processQueue().finally(() => {
      processing = false
      if ([...jobs.values()].some((j) => j.status === 'queued' || j.status === 'retry')) {
        scheduleProcess()
      }
    })
  })
}

const processQueue = async () => {
  for (const job of jobs.values()) {
    if (job.status !== 'queued' && job.status !== 'retry') continue

    job.status = 'running'
    job.attempts += 1

    try {
      await job.handler()
      job.status = 'succeeded'
      logQueue('info', 'Notification delivered', {
        jobId: job.jobId,
        type: job.type,
        attempts: job.attempts,
        ...job.meta,
      })
      jobs.delete(job.jobId)
    } catch (error) {
      job.lastError = error?.message || 'unknown'
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed'
        logQueue('error', 'Notification failed after retries', {
          jobId: job.jobId,
          type: job.type,
          attempts: job.attempts,
          reason: job.lastError,
          ...job.meta,
        })
      } else {
        job.status = 'retry'
        const wait = DEFAULT_BASE_DELAY_MS * 2 ** (job.attempts - 1)
        logQueue('warn', 'Notification delivery failed — retry scheduled', {
          jobId: job.jobId,
          type: job.type,
          attempts: job.attempts,
          nextDelayMs: wait,
          reason: job.lastError,
          ...job.meta,
        })
        await delay(wait)
      }
    }
  }
}

/** Test helpers */
export const getNotificationQueueSnapshot = () =>
  [...jobs.values()].map(({ jobId, type, status, attempts, lastError, meta }) => ({
    jobId,
    type,
    status,
    attempts,
    lastError,
    meta,
  }))

export const clearNotificationQueue = () => {
  jobs.clear()
  processing = false
}

export const flushNotificationQueue = async () => {
  // Drain until idle (used by tests).
  for (let i = 0; i < 20; i += 1) {
    await processQueue()
    const pending = [...jobs.values()].some((j) => j.status === 'queued' || j.status === 'retry')
    if (!pending) break
    await delay(50)
  }
}

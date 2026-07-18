/**
 * In-process DB poller for expired PENDING_PAYMENT slot holds.
 * State lives on appointments.holdExpiresAt so releases survive restarts.
 */
import { releaseExpiredPaymentHolds } from './paymentHoldService.js'

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_BATCH_SIZE = 10

let intervalHandle = null
let running = false
let stopped = true

const logWorker = (level, message, meta = {}) => {
  const entry = {
    scope: 'payment_hold_worker',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

export const processDuePaymentHolds = async ({
  limit = DEFAULT_BATCH_SIZE,
  now = new Date(),
  expireCheckout = true,
} = {}) => {
  return releaseExpiredPaymentHolds({ limit, now, expireCheckout })
}

const tick = async () => {
  if (stopped || running) return
  running = true
  try {
    await processDuePaymentHolds()
  } catch (error) {
    logWorker('error', 'Payment hold worker tick failed', { error: error.message })
  } finally {
    running = false
  }
}

export const startPaymentHoldWorker = ({
  intervalMs = Number(process.env.PAYMENT_HOLD_WORKER_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
} = {}) => {
  if (intervalHandle) return { started: false, reason: 'already_running' }
  stopped = false
  intervalHandle = setInterval(() => {
    tick()
  }, intervalMs)
  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref()
  }
  logWorker('info', 'Payment hold worker started', { intervalMs })
  return { started: true, intervalMs }
}

export const stopPaymentHoldWorker = () => {
  stopped = true
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  running = false
  logWorker('info', 'Payment hold worker stopped')
}

export const isPaymentHoldWorkerRunning = () => Boolean(intervalHandle) && !stopped

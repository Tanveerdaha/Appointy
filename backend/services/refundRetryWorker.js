/**
 * In-process DB poller for failed / stale refund recovery.
 * State lives on stripe_payments (refundNextRetryAt, refundRetryCount) so retries
 * survive process restarts — unlike the notification queue.
 */
import {
  findDueRefundRetries,
  retryOrReconcileFailedRefund,
  RefundError,
} from './refundService.js'
import { ACTOR_TYPE } from './appointmentStateService.js'

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_BATCH_SIZE = 10

let intervalHandle = null
let running = false
let stopped = true

const logWorker = (level, message, meta = {}) => {
  const entry = {
    scope: 'refund_retry_worker',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

export const processDueRefundRetries = async ({
  limit = DEFAULT_BATCH_SIZE,
  createRefundFn = null,
  retrieveRefundFn = null,
  listRefundsFn = null,
} = {}) => {
  const due = await findDueRefundRetries({ limit })
  const results = []

  for (const payment of due) {
    try {
      const result = await retryOrReconcileFailedRefund({
        appointmentId: payment.appointmentId,
        actorType: ACTOR_TYPE.SYSTEM,
        actorId: null,
        force: false,
        allowStalePending: payment.status === 'REFUND_PENDING',
        createRefundFn,
        retrieveRefundFn,
        listRefundsFn,
      })
      results.push({
        appointmentId: payment.appointmentId,
        paymentId: payment.id,
        outcome: result.outcome,
        ok: true,
      })
      logWorker('info', 'Refund retry processed', {
        appointmentId: payment.appointmentId,
        paymentId: payment.id,
        outcome: result.outcome,
      })
    } catch (error) {
      const code = error instanceof RefundError ? error.code : null
      // Expected contention / not-due races are not worker failures.
      if (
        code === 'refund_pending' ||
        code === 'refund_retry_not_due' ||
        code === 'refund_retry_exhausted' ||
        code === 'already_refunded' ||
        code === 'not_refund_failed'
      ) {
        results.push({
          appointmentId: payment.appointmentId,
          paymentId: payment.id,
          outcome: code,
          ok: true,
        })
        continue
      }
      logWorker('error', 'Refund retry worker item failed', {
        appointmentId: payment.appointmentId,
        paymentId: payment.id,
        error: error.message,
        code,
      })
      results.push({
        appointmentId: payment.appointmentId,
        paymentId: payment.id,
        outcome: 'error',
        ok: false,
        error: error.message,
      })
    }
  }

  return results
}

const tick = async () => {
  if (stopped || running) return
  running = true
  try {
    await processDueRefundRetries()
  } catch (error) {
    logWorker('error', 'Refund retry worker tick failed', { error: error.message })
  } finally {
    running = false
  }
}

export const startRefundRetryWorker = ({
  intervalMs = Number(process.env.REFUND_RETRY_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
} = {}) => {
  if (intervalHandle) return { started: false, reason: 'already_running' }
  stopped = false
  intervalHandle = setInterval(() => {
    tick()
  }, intervalMs)
  // Avoid keeping the process alive solely for the timer in tests.
  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref()
  }
  logWorker('info', 'Refund retry worker started', { intervalMs })
  return { started: true, intervalMs }
}

export const stopRefundRetryWorker = () => {
  stopped = true
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  running = false
  logWorker('info', 'Refund retry worker stopped')
}

export const isRefundRetryWorkerRunning = () => Boolean(intervalHandle) && !stopped

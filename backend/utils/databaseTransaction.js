import sequelize from '../config/mysql.js'

let transactionCounter = 0

const nextTransactionId = () => {
  transactionCounter += 1
  return `tx_${Date.now()}_${transactionCounter}`
}

const logTransaction = (level, message, meta = {}) => {
  const entry = {
    scope: 'database_transaction',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  // Never log passwords, payment secrets, or sensitive user payloads.
  if (level === 'error') console.error(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

const safeLog = (level, message, meta = {}) => {
  try {
    logTransaction(level, message, meta)
  } catch {
    // Logging must never alter transaction outcomes or hide the original error.
  }
}

/**
 * Recognized deadlock / lock-timeout signals (MySQL + Sequelize wrappers).
 * Only these are optionally retried — business and validation errors are never retried.
 */
export const isDeadlockError = (error) => {
  if (!error) return false
  const code = error.parent?.code || error.original?.code || error.code
  if (code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' || code === '40P01') {
    return true
  }
  const message = String(error.message || '')
  return /deadlock/i.test(message) || /lock wait timeout/i.test(message)
}

/**
 * Managed Sequelize transaction wrapper.
 * Commits automatically on success; rolls back automatically on throw.
 * Never rolls back after a successful commit.
 *
 * Optional:
 * - isolationLevel: forwarded to Sequelize
 * - retryDeadlocks: when true, retries only recognized deadlock/lock-timeout errors
 * - maxRetries: additional attempts after the first (default 2 → 3 total attempts)
 *
 * @template T
 * @param {(transaction: import('sequelize').Transaction) => Promise<T>} callback
 * @param {{
 *   operation?: string,
 *   isolationLevel?: string,
 *   retryDeadlocks?: boolean,
 *   maxRetries?: number,
 * }} [options]
 * @returns {Promise<T>}
 */
export async function withTransaction(callback, options = {}) {
  const {
    operation = 'unnamed',
    isolationLevel,
    retryDeadlocks = false,
    maxRetries = 2,
  } = options

  const transactionId = nextTransactionId()
  const attemptsAllowed = retryDeadlocks ? Math.max(1, Number(maxRetries) + 1) : 1
  let attempt = 0
  let lastError = null

  while (attempt < attemptsAllowed) {
    attempt += 1
    safeLog('info', 'Transaction started', {
      transactionId,
      operation,
      attempt,
      isolationLevel: isolationLevel || null,
    })

    try {
      const sequelizeOptions = isolationLevel ? { isolationLevel } : undefined

      // Sole application entry for sequelize.transaction — commits on resolve, rolls back on throw.
      const result = sequelizeOptions
        ? await sequelize.transaction(sequelizeOptions, async (transaction) => callback(transaction))
        : await sequelize.transaction(async (transaction) => callback(transaction))

      safeLog('info', 'Transaction committed', {
        transactionId,
        operation,
        attempt,
      })

      return result
    } catch (error) {
      lastError = error
      const isBusinessError =
        typeof error?.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
      const canRetry =
        retryDeadlocks && attempt < attemptsAllowed && isDeadlockError(error) && !isBusinessError

      safeLog(isBusinessError ? 'info' : 'error', 'Transaction rolled back', {
        transactionId,
        operation,
        attempt,
        reason: error?.message || 'unknown',
        code: error?.code || error?.parent?.code || null,
        willRetry: canRetry,
      })

      if (canRetry) {
        safeLog('warn', 'Retrying transaction after deadlock/lock timeout', {
          transactionId,
          operation,
          attempt,
          nextAttempt: attempt + 1,
        })
        continue
      }

      throw error
    }
  }

  throw lastError
}

export default { withTransaction, isDeadlockError }

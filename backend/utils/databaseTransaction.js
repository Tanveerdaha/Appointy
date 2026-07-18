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

/**
 * Managed Sequelize transaction wrapper.
 * Commits automatically on success; rolls back automatically on throw.
 * Never rolls back after a successful commit.
 *
 * @template T
 * @param {(transaction: import('sequelize').Transaction) => Promise<T>} callback
 * @param {{ operation?: string }} [options]
 * @returns {Promise<T>}
 */
export async function withTransaction(callback, { operation = 'unnamed' } = {}) {
  const transactionId = nextTransactionId()

  logTransaction('info', 'Transaction started', { transactionId, operation })

  try {
    const result = await sequelize.transaction(async (transaction) => {
      return callback(transaction)
    })

    logTransaction('info', 'Transaction committed', { transactionId, operation })
    return result
  } catch (error) {
    const isBusinessError =
      typeof error?.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
    logTransaction(isBusinessError ? 'info' : 'error', 'Transaction rolled back', {
      transactionId,
      operation,
      reason: error?.message || 'unknown',
      code: error?.code || null,
    })
    throw error
  }
}

/**
 * Safe manual rollback for legacy call sites that still own a transaction.
 * No-ops if the transaction is missing or already finished (committed/rolled back).
 */
export async function safeRollback(transaction, { reason = null } = {}) {
  if (!transaction || transaction.finished) return false
  try {
    await transaction.rollback()
    logTransaction('info', 'Transaction rolled back', {
      transactionId: transaction.id || null,
      reason,
    })
    return true
  } catch (error) {
    logTransaction('error', 'Rollback failed (original error preserved by caller)', {
      reason: error?.message || 'unknown',
    })
    return false
  }
}

export default { withTransaction, safeRollback }

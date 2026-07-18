/**
 * Unit tests for the canonical withTransaction helper.
 *
 * Covers: automatic commit, automatic rollback, error/result identity,
 * isolation forwarding, deadlock retry / exhaustion, and non-disruptive logging.
 */
import { jest } from '@jest/globals'

const mockTransaction = jest.fn()

jest.unstable_mockModule('../config/mysql.js', () => ({
  default: {
    transaction: mockTransaction,
  },
}))

const { withTransaction, isDeadlockError } = await import('../utils/databaseTransaction.js')

beforeEach(() => {
  mockTransaction.mockReset()
})

describe('isDeadlockError', () => {
  test('detects MySQL deadlock and lock-wait codes', () => {
    expect(isDeadlockError({ parent: { code: 'ER_LOCK_DEADLOCK' } })).toBe(true)
    expect(isDeadlockError({ original: { code: 'ER_LOCK_WAIT_TIMEOUT' } })).toBe(true)
    expect(isDeadlockError({ code: '40P01' })).toBe(true)
    expect(isDeadlockError(new Error('Deadlock found when trying to get lock'))).toBe(true)
    expect(isDeadlockError(new Error('unique constraint'))).toBe(false)
    expect(isDeadlockError(null)).toBe(false)
  })
})

describe('withTransaction', () => {
  test('commits automatically and returns callback result', async () => {
    mockTransaction.mockImplementation(async (cb) => cb({ id: 't1' }))

    const result = await withTransaction(async (transaction) => {
      expect(transaction.id).toBe('t1')
      return { ok: true }
    }, { operation: 'test_commit' })

    expect(result).toEqual({ ok: true })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  test('rolls back automatically and preserves original error identity', async () => {
    const original = Object.assign(new Error('boom'), {
      statusCode: 409,
      code: 'conflict',
    })
    mockTransaction.mockImplementation(async (cb) => {
      await cb({ id: 't1' })
    })

    await expect(
      withTransaction(async () => {
        throw original
      }, { operation: 'test_rollback' })
    ).rejects.toBe(original)
  })

  test('forwards isolationLevel to sequelize.transaction', async () => {
    mockTransaction.mockImplementation(async (options, cb) => {
      expect(options).toEqual({ isolationLevel: 'SERIALIZABLE' })
      return cb({ id: 't1' })
    })

    await withTransaction(async () => 'done', {
      operation: 'test_isolation',
      isolationLevel: 'SERIALIZABLE',
    })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction.mock.calls[0][0]).toEqual({ isolationLevel: 'SERIALIZABLE' })
  })

  test('retries only deadlock errors when retryDeadlocks is enabled', async () => {
    const deadlock = Object.assign(new Error('Deadlock found'), {
      parent: { code: 'ER_LOCK_DEADLOCK' },
    })
    mockTransaction
      .mockImplementationOnce(async () => {
        throw deadlock
      })
      .mockImplementationOnce(async (cb) => cb({ id: 't2' }))

    const result = await withTransaction(async () => ({ retried: true }), {
      operation: 'test_deadlock_retry',
      retryDeadlocks: true,
      maxRetries: 2,
    })

    expect(result).toEqual({ retried: true })
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  test('exhausts deadlock retries and preserves the original error', async () => {
    const deadlock = Object.assign(new Error('Deadlock found'), {
      parent: { code: 'ER_LOCK_DEADLOCK' },
    })
    mockTransaction.mockImplementation(async () => {
      throw deadlock
    })

    await expect(
      withTransaction(async () => 'never', {
        operation: 'test_deadlock_exhaust',
        retryDeadlocks: true,
        maxRetries: 1,
      })
    ).rejects.toBe(deadlock)

    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  test('does not retry non-deadlock errors even when retryDeadlocks is enabled', async () => {
    const validation = Object.assign(new Error('invalid'), {
      statusCode: 400,
      code: 'bad_request',
    })
    mockTransaction.mockImplementation(async () => {
      throw validation
    })

    await expect(
      withTransaction(async () => 'never', {
        operation: 'test_no_retry_business',
        retryDeadlocks: true,
        maxRetries: 3,
      })
    ).rejects.toBe(validation)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  test('logging failures after commit do not fail the caller', async () => {
    mockTransaction.mockImplementation(async (cb) => cb({ id: 't1' }))
    const originalLog = console.log
    console.log = () => {
      throw new Error('logger down')
    }

    try {
      const result = await withTransaction(async () => ({ survived: true }), {
        operation: 'test_log_commit',
      })
      expect(result).toEqual({ survived: true })
    } finally {
      console.log = originalLog
    }
  })
})

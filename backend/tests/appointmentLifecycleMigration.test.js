/**
 * Migration backfill tests for appointment lifecycle history migration.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { Sequelize, DataTypes } from 'sequelize'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'

const require = createRequire(import.meta.url)
const migration = require('../migrations/20260718000004-appointment-lifecycle-history.cjs')

describe('appointment lifecycle migration backfill', () => {
  let sequelize
  let queryInterface

  beforeAll(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    })
    queryInterface = sequelize.getQueryInterface()

    await queryInterface.createTable('appointments', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      docId: { type: DataTypes.UUID, allowNull: false },
      startTime: { type: DataTypes.DATE, allowNull: false },
      heldStartTime: { type: DataTypes.DATE, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'CONFIRMED' },
      slotDate: { type: DataTypes.STRING, allowNull: false },
      slotTime: { type: DataTypes.STRING, allowNull: false },
      userData: { type: DataTypes.JSON, allowNull: false },
      docData: { type: DataTypes.JSON, allowNull: false },
      amount: { type: DataTypes.INTEGER, allowNull: false },
      date: { type: DataTypes.BIGINT, allowNull: false },
      cancelled: { type: DataTypes.BOOLEAN, defaultValue: false },
      isCompleted: { type: DataTypes.BOOLEAN, defaultValue: false },
      payment: { type: DataTypes.BOOLEAN, defaultValue: false },
      paymentStatus: { type: DataTypes.STRING, defaultValue: 'unpaid' },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    })
  })

  afterAll(async () => {
    await sequelize.close()
  })

  test('Test 7 — contradictory booleans and legacy statuses backfill correctly', async () => {
    const now = new Date()
    const start = new Date('2030-01-01T05:00:00.000Z')
    const rows = [
      {
        id: randomUUID(),
        label: 'both_true',
        cancelled: 1,
        isCompleted: 1,
        paymentStatus: 'paid',
        status: 'CONFIRMED',
        heldStartTime: start,
      },
      {
        id: randomUUID(),
        label: 'completed',
        cancelled: 0,
        isCompleted: 1,
        paymentStatus: 'paid',
        status: 'CONFIRMED',
        heldStartTime: start,
      },
      {
        id: randomUUID(),
        label: 'pending',
        cancelled: 0,
        isCompleted: 0,
        paymentStatus: 'pending',
        status: 'LEGACY_UNKNOWN',
        heldStartTime: start,
      },
      {
        id: randomUUID(),
        label: 'refunded_legacy',
        cancelled: 0,
        isCompleted: 0,
        paymentStatus: 'paid',
        status: 'REFUNDED',
        heldStartTime: null,
      },
      {
        id: randomUUID(),
        label: 'confirmed',
        cancelled: 0,
        isCompleted: 0,
        paymentStatus: 'unpaid',
        status: 'CONFIRMED',
        heldStartTime: start,
      },
    ]

    for (const row of rows) {
      await sequelize.query(
        `INSERT INTO appointments
          (id, userId, docId, startTime, heldStartTime, status, slotDate, slotTime, userData, docData, amount, date, cancelled, isCompleted, payment, paymentStatus, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, '1_1_2030', '10:00 AM', '{}', '{}', 100, ?, ?, ?, 0, ?, ?, ?)`,
        {
          replacements: [
            row.id,
            randomUUID(),
            randomUUID(),
            start,
            row.heldStartTime,
            row.status,
            Date.now(),
            row.cancelled,
            row.isCompleted,
            row.paymentStatus,
            now,
            now,
          ],
        }
      )
    }

    await migration.up(queryInterface, Sequelize)

    const [updated] = await sequelize.query(
      `SELECT id, status, cancelled, isCompleted, heldStartTime, statusChangedAt FROM appointments`
    )
    const byId = Object.fromEntries(updated.map((r) => [r.id, r]))

    expect(byId[rows[0].id].status).toBe('CANCELLED')
    expect(byId[rows[0].id].cancelled).toBe(1)
    expect(byId[rows[0].id].isCompleted).toBe(0)
    expect(byId[rows[0].id].heldStartTime).toBeNull()

    expect(byId[rows[1].id].status).toBe('COMPLETED')
    expect(byId[rows[1].id].isCompleted).toBe(1)
    expect(byId[rows[1].id].cancelled).toBe(0)

    expect(byId[rows[2].id].status).toBe('PENDING_PAYMENT')
    expect(byId[rows[3].id].status).toBe('CANCELLED')
    expect(byId[rows[4].id].status).toBe('CONFIRMED')

    for (const row of updated) {
      expect(row.statusChangedAt).toBeTruthy()
    }

    const [histories] = await sequelize.query(`SELECT * FROM appointment_histories`)
    expect(histories.length).toBe(rows.length)
    expect(histories.every((h) => h.actorType === 'MIGRATION')).toBe(true)
    expect(histories.every((h) => h.oldStatus === null)).toBe(true)
  })
})

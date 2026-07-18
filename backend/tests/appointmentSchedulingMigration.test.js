/**
 * Migration preflight / backfill tests for appointment scheduling protection.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import { Sequelize, DataTypes } from 'sequelize'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'

const require = createRequire(import.meta.url)
const migration = require('../migrations/20260718000003-appointment-scheduling-protection.cjs')

const createLegacyAppointmentsTable = async (queryInterface) => {
  await queryInterface.createTable('appointments', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    docId: { type: DataTypes.UUID, allowNull: false },
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
}

const insertLegacy = async (sequelize, row) => {
  const now = row.createdAt || new Date('2020-01-01T00:00:00.000Z')
  await sequelize.query(
    `INSERT INTO appointments
      (id, userId, docId, slotDate, slotTime, userData, docData, amount, date, cancelled, isCompleted, payment, paymentStatus, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, '{}', '{}', 100, ?, ?, ?, 0, ?, ?, ?)`,
    {
      replacements: [
        row.id,
        row.userId || randomUUID(),
        row.docId,
        row.slotDate,
        row.slotTime,
        Date.now(),
        row.cancelled ? 1 : 0,
        row.isCompleted ? 1 : 0,
        row.paymentStatus || 'unpaid',
        now,
        now,
      ],
    }
  )
}

describe('appointment scheduling migration preflight', () => {
  let sequelize
  let queryInterface

  beforeEach(async () => {
    process.env.SCHEDULING_TIMEZONE = 'Asia/Karachi'
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    })
    queryInterface = sequelize.getQueryInterface()
    await createLegacyAppointmentsTable(queryInterface)
  })

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close()
      sequelize = null
    }
  })

  test('aborts on unparseable slotDate/slotTime before schema changes', async () => {
    const id = randomUUID()
    await insertLegacy(sequelize, {
      id,
      docId: randomUUID(),
      slotDate: 'not_a_date',
      slotTime: 'bogus',
      cancelled: false,
    })

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(/unparseable legacy slots/)

    const table = await queryInterface.describeTable('appointments')
    expect(table.startTime).toBeUndefined()
    expect(table.heldStartTime).toBeUndefined()
    expect(table.status).toBeUndefined()
  })

  test('aborts on duplicate held doctor/time pairs', async () => {
    const docId = randomUUID()
    const idA = randomUUID()
    const idB = randomUUID()
    await insertLegacy(sequelize, {
      id: idA,
      docId,
      slotDate: '22_7_2030',
      slotTime: '10:00 AM',
      cancelled: false,
    })
    await insertLegacy(sequelize, {
      id: idB,
      docId,
      slotDate: '22_7_2030',
      slotTime: '10:00 AM',
      cancelled: false,
    })

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(/duplicate held doctor slots/)

    const table = await queryInterface.describeTable('appointments')
    expect(table.startTime).toBeUndefined()
  })

  test('succeeds when one of two same-slot rows is cancelled', async () => {
    const docId = randomUUID()
    await insertLegacy(sequelize, {
      id: randomUUID(),
      docId,
      slotDate: '22_7_2030',
      slotTime: '10:00 AM',
      cancelled: false,
    })
    await insertLegacy(sequelize, {
      id: randomUUID(),
      docId,
      slotDate: '22_7_2030',
      slotTime: '10:00 AM',
      cancelled: true,
    })

    await migration.up(queryInterface, Sequelize)

    const [rows] = await sequelize.query(
      `SELECT status, heldStartTime FROM appointments ORDER BY cancelled ASC`
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe('CONFIRMED')
    expect(rows[0].heldStartTime).toBeTruthy()
    expect(rows[1].status).toBe('CANCELLED')
    expect(rows[1].heldStartTime).toBeNull()
  })

  test('backfills startTime from parsed slot, not createdAt', async () => {
    const id = randomUUID()
    const createdAt = new Date('2019-06-15T12:00:00.000Z')
    await insertLegacy(sequelize, {
      id,
      docId: randomUUID(),
      slotDate: '22_7_2030',
      slotTime: '10:00 AM',
      cancelled: false,
      createdAt,
    })

    await migration.up(queryInterface, Sequelize)

    const [rows] = await sequelize.query(
      `SELECT startTime, heldStartTime, status FROM appointments WHERE id = ?`,
      { replacements: [id] }
    )
    expect(rows).toHaveLength(1)
    // Clinic +05:00 → 22 Jul 2030 10:00 = 2030-07-22T05:00:00.000Z
    const expected = new Date('2030-07-22T05:00:00.000Z')
    expect(new Date(rows[0].startTime).getTime()).toBe(expected.getTime())
    expect(new Date(rows[0].heldStartTime).getTime()).toBe(expected.getTime())
    expect(new Date(rows[0].startTime).getTime()).not.toBe(createdAt.getTime())
    expect(rows[0].status).toBe('CONFIRMED')
  })
})

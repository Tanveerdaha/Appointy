/**
 * Migration preflight for doctor soft-delete integrity FKs.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { Sequelize, DataTypes } from 'sequelize'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'

const require = createRequire(import.meta.url)
const migration = require('../migrations/20260718000010-doctor-soft-delete-integrity.cjs')

describe('doctor soft-delete integrity migration', () => {
  let sequelize
  let queryInterface

  beforeAll(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    })
    queryInterface = sequelize.getQueryInterface()
    await sequelize.query('PRAGMA foreign_keys = ON')

    await queryInterface.createTable('doctors', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false },
      password: { type: DataTypes.STRING, allowNull: false },
      image: { type: DataTypes.STRING, allowNull: false },
      speciality: { type: DataTypes.STRING, allowNull: false },
      degree: { type: DataTypes.STRING, allowNull: false },
      experience: { type: DataTypes.STRING, allowNull: false },
      about: { type: DataTypes.TEXT, allowNull: false },
      available: { type: DataTypes.BOOLEAN, defaultValue: true },
      fees: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      slots_booked: { type: DataTypes.JSON, allowNull: true },
      address: { type: DataTypes.JSON, allowNull: false },
      date: { type: DataTypes.BIGINT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    })

    await queryInterface.createTable('appointments', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      docId: { type: DataTypes.UUID, allowNull: false },
      slotDate: { type: DataTypes.STRING, allowNull: false },
      slotTime: { type: DataTypes.STRING, allowNull: false },
      userData: { type: DataTypes.JSON, allowNull: false },
      docData: { type: DataTypes.JSON, allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      date: { type: DataTypes.BIGINT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    })

    await queryInterface.createTable('doctor_price_histories', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      doctorId: { type: DataTypes.UUID, allowNull: false },
      oldFee: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      newFee: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      changedBy: { type: DataTypes.STRING, allowNull: false },
      changedByRole: { type: DataTypes.STRING, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
    })
  })

  afterAll(async () => {
    await sequelize.close()
  })

  test('aborts when appointments reference missing doctors', async () => {
    const now = new Date()
    await queryInterface.bulkInsert('appointments', [
      {
        id: randomUUID(),
        userId: randomUUID(),
        docId: randomUUID(),
        slotDate: '1_1_2030',
        slotTime: '10:00 AM',
        userData: JSON.stringify({}),
        docData: JSON.stringify({}),
        amount: 500,
        date: Date.now(),
        createdAt: now,
        updatedAt: now,
      },
    ])

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
      /appointments reference missing doctors/
    )
  })

  test('adds deletedAt and FKs when references are valid', async () => {
    await sequelize.query('DELETE FROM appointments')
    await sequelize.query('DELETE FROM doctor_price_histories')
    await sequelize.query('DELETE FROM doctors')

    const doctorId = randomUUID()
    const now = new Date()
    await queryInterface.bulkInsert('doctors', [
      {
        id: doctorId,
        name: 'Dr Migrate',
        email: 'migrate@test.com',
        password: 'hash',
        image: 'img.png',
        speciality: 'General',
        degree: 'MBBS',
        experience: '1 Year',
        about: 'about',
        available: true,
        fees: 500,
        slots_booked: JSON.stringify({}),
        address: JSON.stringify({ line1: 'A', line2: 'B' }),
        date: Date.now(),
        createdAt: now,
        updatedAt: now,
      },
    ])
    await queryInterface.bulkInsert('appointments', [
      {
        id: randomUUID(),
        userId: randomUUID(),
        docId: doctorId,
        slotDate: '1_1_2030',
        slotTime: '10:00 AM',
        userData: JSON.stringify({}),
        docData: JSON.stringify({}),
        amount: 500,
        date: Date.now(),
        createdAt: now,
        updatedAt: now,
      },
    ])
    await queryInterface.bulkInsert('doctor_price_histories', [
      {
        id: randomUUID(),
        doctorId,
        oldFee: 400,
        newFee: 500,
        changedBy: 'admin',
        changedByRole: 'admin',
        createdAt: now,
      },
    ])

    await migration.up(queryInterface, Sequelize)

    const doctors = await queryInterface.describeTable('doctors')
    expect(doctors.deletedAt).toBeDefined()

    // Second run is idempotent
    await migration.up(queryInterface, Sequelize)
  })
})

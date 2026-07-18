/**
 * Pending-migration detection used for production / USE_MIGRATIONS boot guard.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import { Sequelize, DataTypes } from 'sequelize'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  listMigrationFiles,
  getPendingMigrations,
  assertNoPendingMigrations,
} from '../config/migrationStatus.js'

describe('migrationStatus', () => {
  let sequelize
  let tmpDir

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    })
    await sequelize.authenticate()

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appointy-migrations-'))
    for (const name of [
      '20250101000001-one.cjs',
      '20250101000002-two.cjs',
      '20250101000003-three.cjs',
    ]) {
      fs.writeFileSync(path.join(tmpDir, name), 'module.exports = {}')
    }
  })

  afterEach(async () => {
    await sequelize.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const createMetaTable = async () => {
    await sequelize.getQueryInterface().createTable('SequelizeMeta', {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        primaryKey: true,
      },
    })
  }

  const recordApplied = async (...names) => {
    for (const name of names) {
      await sequelize.query('INSERT INTO `SequelizeMeta` (name) VALUES (?)', {
        replacements: [name],
      })
    }
  }

  test('listMigrationFiles returns sorted .cjs/.js basenames', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'ignore')
    expect(listMigrationFiles(tmpDir)).toEqual([
      '20250101000001-one.cjs',
      '20250101000002-two.cjs',
      '20250101000003-three.cjs',
    ])
  })

  test('missing SequelizeMeta treats all on-disk migrations as pending', async () => {
    const pending = await getPendingMigrations(sequelize, tmpDir)
    expect(pending).toEqual([
      '20250101000001-one.cjs',
      '20250101000002-two.cjs',
      '20250101000003-three.cjs',
    ])
    await expect(assertNoPendingMigrations(sequelize, tmpDir)).rejects.toThrow(
      /Pending database migrations \(3\):/
    )
  })

  test('partial SequelizeMeta reports only missing migrations', async () => {
    await createMetaTable()
    await recordApplied('20250101000001-one.cjs')

    const pending = await getPendingMigrations(sequelize, tmpDir)
    expect(pending).toEqual([
      '20250101000002-two.cjs',
      '20250101000003-three.cjs',
    ])
  })

  test('fully applied migrations pass assertNoPendingMigrations', async () => {
    await createMetaTable()
    await recordApplied(
      '20250101000001-one.cjs',
      '20250101000002-two.cjs',
      '20250101000003-three.cjs'
    )

    await expect(
      assertNoPendingMigrations(sequelize, tmpDir)
    ).resolves.toBeUndefined()
    expect(await getPendingMigrations(sequelize, tmpDir)).toEqual([])
  })
})

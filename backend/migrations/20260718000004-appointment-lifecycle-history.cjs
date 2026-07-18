'use strict';

/**
 * Appointment lifecycle hardening:
 * - timestamps (statusChangedAt, completedAt, cancelledAt)
 * - appointment_histories audit table
 * - canonicalize contradictory legacy boolean/status combinations
 * - CHECK constraint + composite indexes
 *
 * Refunds remain payment-only; appointment-level REFUNDED is normalized away.
 */

const CANONICAL_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

const SLOT_HOLDING = new Set(['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED']);

const resolveCanonicalStatus = (row) => {
  if (row.cancelled) return 'CANCELLED';
  if (row.isCompleted) return 'COMPLETED';

  const existing = row.status;
  if (existing === 'REFUNDED') {
    return row.isCompleted ? 'COMPLETED' : 'CANCELLED';
  }
  if (CANONICAL_STATUSES.includes(existing)) return existing;
  if (row.paymentStatus === 'pending') return 'PENDING_PAYMENT';
  return 'CONFIRMED';
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    const table = await queryInterface.describeTable('appointments');

    if (!table.statusChangedAt) {
      await queryInterface.addColumn('appointments', 'statusChangedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!table.completedAt) {
      await queryInterface.addColumn('appointments', 'completedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!table.cancelledAt) {
      await queryInterface.addColumn('appointments', 'cancelledAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    const [rows] = await queryInterface.sequelize.query(
      `SELECT id, cancelled, isCompleted, paymentStatus, status, heldStartTime, startTime, createdAt, updatedAt
       FROM appointments`
    );

    // Preflight: unknown statuses that cannot be mapped safely after boolean precedence.
    const unknown = [];
    for (const row of rows) {
      const status = resolveCanonicalStatus(row);
      if (!CANONICAL_STATUSES.includes(status)) {
        unknown.push({ id: row.id, status: row.status });
      }
    }
    if (unknown.length) {
      throw new Error(
        `Migration aborted: unknown appointment statuses: ${JSON.stringify(unknown.slice(0, 20))}`
      );
    }

    // Preflight: duplicate held slots among slot-holding statuses.
    const [heldRows] = await queryInterface.sequelize.query(
      `SELECT id, docId, heldStartTime, startTime, cancelled, isCompleted, status, paymentStatus, createdAt, updatedAt
       FROM appointments`
    );

    const slotMap = new Map();
    const duplicates = [];
    for (const row of heldRows) {
      const status = resolveCanonicalStatus(row);
      if (!SLOT_HOLDING.has(status)) continue;
      const held = row.heldStartTime || row.startTime;
      if (!held) continue;
      const key = `${row.docId}|${new Date(held).toISOString()}`;
      if (slotMap.has(key)) {
        duplicates.push({ key, ids: [slotMap.get(key), row.id] });
      } else {
        slotMap.set(key, row.id);
      }
    }
    if (duplicates.length) {
      throw new Error(
        `Migration aborted: duplicate held doctor slots: ${JSON.stringify(duplicates.slice(0, 20))}`
      );
    }

    for (const row of heldRows) {
      const status = resolveCanonicalStatus(row);
      const nowApprox = row.updatedAt || row.createdAt || new Date();
      const createdApprox = row.createdAt || nowApprox;

      const cancelled = status === 'CANCELLED' || status === 'NO_SHOW';
      const isCompleted = status === 'COMPLETED';
      const heldStartTime = SLOT_HOLDING.has(status)
        ? (row.heldStartTime || row.startTime)
        : null;

      let statusChangedAt = createdApprox;
      let completedAt = null;
      let cancelledAt = null;
      if (status === 'COMPLETED') {
        statusChangedAt = nowApprox;
        completedAt = nowApprox;
      } else if (status === 'CANCELLED' || status === 'NO_SHOW') {
        statusChangedAt = nowApprox;
        cancelledAt = nowApprox;
      } else if (status === 'PENDING_PAYMENT' || status === 'CONFIRMED') {
        statusChangedAt = createdApprox;
      }

      await queryInterface.sequelize.query(
        `UPDATE appointments
         SET status = ?,
             cancelled = ?,
             isCompleted = ?,
             heldStartTime = ?,
             statusChangedAt = ?,
             completedAt = ?,
             cancelledAt = ?
         WHERE id = ?`,
        {
          replacements: [
            status,
            cancelled ? 1 : 0,
            isCompleted ? 1 : 0,
            heldStartTime,
            statusChangedAt,
            completedAt,
            cancelledAt,
            row.id,
          ],
        }
      );
    }

    // Ensure statusChangedAt is populated for any row that somehow remains null.
    await queryInterface.sequelize.query(
      `UPDATE appointments SET statusChangedAt = COALESCE(statusChangedAt, updatedAt, createdAt, CURRENT_TIMESTAMP)
       WHERE statusChangedAt IS NULL`
    );

    await queryInterface.changeColumn('appointments', 'statusChangedAt', {
      type: Sequelize.DATE,
      allowNull: false,
    });

    // appointment_histories
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name));
    if (!normalized.includes('appointment_histories')) {
      await queryInterface.createTable('appointment_histories', {
        id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
        },
        appointmentId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'appointments',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        oldStatus: {
          type: Sequelize.STRING(32),
          allowNull: true,
        },
        newStatus: {
          type: Sequelize.STRING(32),
          allowNull: false,
        },
        outcome: {
          type: Sequelize.STRING(16),
          allowNull: false,
          defaultValue: 'SUCCEEDED',
        },
        actorType: {
          type: Sequelize.STRING(16),
          allowNull: false,
        },
        actorId: {
          type: Sequelize.UUID,
          allowNull: true,
        },
        reason: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        errorCode: {
          type: Sequelize.STRING(64),
          allowNull: true,
        },
        metadata: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        occurredAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
      });

      await queryInterface.addIndex('appointment_histories', ['appointmentId', 'occurredAt'], {
        name: 'appointment_histories_appointment_occurred_at',
      });
      await queryInterface.addIndex('appointment_histories', ['newStatus', 'occurredAt'], {
        name: 'appointment_histories_new_status_occurred_at',
      });
      await queryInterface.addIndex('appointment_histories', ['outcome'], {
        name: 'appointment_histories_outcome',
      });
    }

    // Seed one baseline history row per appointment if none exists.
    const [existingHistory] = await queryInterface.sequelize.query(
      `SELECT appointmentId FROM appointment_histories`
    );
    const hasHistory = new Set(existingHistory.map((r) => r.appointmentId));

    const { randomUUID } = require('crypto');
    const [currentRows] = await queryInterface.sequelize.query(
      `SELECT id, status, statusChangedAt, cancelled, isCompleted FROM appointments`
    );

    for (const row of currentRows) {
      if (hasHistory.has(row.id)) continue;
      const occurredAt = row.statusChangedAt || new Date();
      const meta = JSON.stringify({
        source: 'legacy_lifecycle_backfill',
        contradictoryBooleans: !!(row.cancelled && row.isCompleted),
      });
      await queryInterface.sequelize.query(
        `INSERT INTO appointment_histories
          (id, appointmentId, oldStatus, newStatus, outcome, actorType, actorId, reason, errorCode, metadata, occurredAt, createdAt, updatedAt)
         VALUES (?, ?, NULL, ?, 'SUCCEEDED', 'MIGRATION', NULL, 'Legacy lifecycle backfill', NULL, ?, ?, ?, ?)`,
        {
          replacements: [
            randomUUID(),
            row.id,
            row.status,
            meta,
            occurredAt,
            occurredAt,
            occurredAt,
          ],
        }
      );
    }

    // Indexes on appointments
    const indexes = await queryInterface.showIndex('appointments');
    const indexNames = new Set(indexes.map((i) => i.name));

    if (!indexNames.has('appointments_doc_status_start_time')) {
      await queryInterface.addIndex('appointments', ['docId', 'status', 'startTime'], {
        name: 'appointments_doc_status_start_time',
      });
    }
    if (!indexNames.has('appointments_user_status')) {
      await queryInterface.addIndex('appointments', ['userId', 'status'], {
        name: 'appointments_user_status',
      });
    }

    // CHECK constraint for allowed statuses (portable VARCHAR + CHECK).
    if (dialect === 'mysql') {
      try {
        await queryInterface.sequelize.query(
          `ALTER TABLE appointments
           ADD CONSTRAINT appointments_status_check
           CHECK (status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW'))`
        );
      } catch (error) {
        // Constraint may already exist on re-run.
        if (!/Duplicate|already exists|exists/i.test(error.message || '')) {
          throw error;
        }
      }
    } else if (dialect === 'sqlite') {
      // SQLite cannot easily add CHECK via ALTER; enforced at application layer + tests.
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'mysql') {
      try {
        await queryInterface.sequelize.query(
          `ALTER TABLE appointments DROP CHECK appointments_status_check`
        );
      } catch {
        // ignore
      }
    }

    const indexes = await queryInterface.showIndex('appointments');
    const indexNames = new Set(indexes.map((i) => i.name));
    if (indexNames.has('appointments_user_status')) {
      await queryInterface.removeIndex('appointments', 'appointments_user_status');
    }
    if (indexNames.has('appointments_doc_status_start_time')) {
      await queryInterface.removeIndex('appointments', 'appointments_doc_status_start_time');
    }

    await queryInterface.dropTable('appointment_histories');

    const table = await queryInterface.describeTable('appointments');
    if (table.cancelledAt) await queryInterface.removeColumn('appointments', 'cancelledAt');
    if (table.completedAt) await queryInterface.removeColumn('appointments', 'completedAt');
    if (table.statusChangedAt) await queryInterface.removeColumn('appointments', 'statusChangedAt');
  },
};

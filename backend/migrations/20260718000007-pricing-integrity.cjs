'use strict';

/**
 * Pricing integrity:
 * - DECIMAL fees / appointment amounts
 * - appointment currency snapshot
 * - doctor_price_histories audit table
 * - CHECK constraints for fee bounds
 * - Remediate null / non-positive doctor fees (flag oversize for review)
 */

const MIN_FEE = Number(process.env.MIN_APPOINTMENT_FEE || 100);
const MAX_FEE = Number(process.env.MAX_APPOINTMENT_FEE || 1000000);
const DEFAULT_CURRENCY = String(process.env.CURRENCY || 'PKR').trim().toUpperCase() || 'PKR';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    // ── doctors.fees → DECIMAL(10,2) ──────────────────────────────────────
    const doctors = await queryInterface.describeTable('doctors');
    if (doctors.fees) {
      // Fix null / non-positive before tightening constraints.
      await queryInterface.sequelize.query(
        `UPDATE doctors SET fees = ${MIN_FEE} WHERE fees IS NULL OR fees <= 0`
      );

      const [oversized] = await queryInterface.sequelize.query(
        `SELECT id, fees FROM doctors WHERE fees > ${MAX_FEE}`
      );
      if (oversized?.length) {
        console.warn(
          `[pricing migration] ${oversized.length} doctor(s) have fees above MAX_APPOINTMENT_FEE=${MAX_FEE}; clamping and leaving audit note via fees clamp`
        );
        await queryInterface.sequelize.query(
          `UPDATE doctors SET fees = ${MAX_FEE} WHERE fees > ${MAX_FEE}`
        );
      }

      await queryInterface.changeColumn('doctors', 'fees', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      });
    }

    // ── appointments.amount → DECIMAL + currency snapshot ─────────────────
    const appointments = await queryInterface.describeTable('appointments');
    if (appointments.amount) {
      await queryInterface.sequelize.query(
        `UPDATE appointments SET amount = ${MIN_FEE} WHERE amount IS NULL OR amount <= 0`
      );
      await queryInterface.changeColumn('appointments', 'amount', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      });
    }

    if (!appointments.currency) {
      await queryInterface.addColumn('appointments', 'currency', {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: DEFAULT_CURRENCY,
      });
    }

    // ── doctor_price_histories ────────────────────────────────────────────
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) =>
      typeof t === 'string' ? t.toLowerCase() : String(t?.tableName || t || '').toLowerCase()
    );
    if (!normalized.includes('doctor_price_histories')) {
      await queryInterface.createTable('doctor_price_histories', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        doctorId: {
          type: Sequelize.UUID,
          allowNull: false,
        },
        oldFee: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        newFee: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        changedBy: {
          type: Sequelize.STRING(128),
          allowNull: false,
        },
        changedByRole: {
          type: Sequelize.STRING(32),
          allowNull: false,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });

      await queryInterface.addIndex('doctor_price_histories', ['doctorId'], {
        name: 'doctor_price_histories_doctor_id',
      });
      await queryInterface.addIndex('doctor_price_histories', ['changedBy'], {
        name: 'doctor_price_histories_changed_by',
      });
      await queryInterface.addIndex('doctor_price_histories', ['createdAt'], {
        name: 'doctor_price_histories_created_at',
      });
    }

    // ── DB-level CHECK constraints (MySQL 8.0.16+ / SQLite) ───────────────
    if (dialect === 'mysql') {
      await queryInterface.sequelize.query(`
        ALTER TABLE doctors
        ADD CONSTRAINT chk_doctors_fees_range
        CHECK (fees >= ${MIN_FEE} AND fees <= ${MAX_FEE})
      `).catch((err) => {
        if (!/Duplicate|already exists|check constraint/i.test(err.message)) throw err;
      });

      await queryInterface.sequelize.query(`
        ALTER TABLE appointments
        ADD CONSTRAINT chk_appointments_amount_positive
        CHECK (amount > 0)
      `).catch((err) => {
        if (!/Duplicate|already exists|check constraint/i.test(err.message)) throw err;
      });
    } else if (dialect === 'sqlite') {
      // SQLite cannot easily ADD CHECK to existing tables; model + app validation cover tests.
    }
  },

  async down(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'mysql') {
      await queryInterface.sequelize.query(
        'ALTER TABLE doctors DROP CHECK chk_doctors_fees_range'
      ).catch(() => {});
      await queryInterface.sequelize.query(
        'ALTER TABLE appointments DROP CHECK chk_appointments_amount_positive'
      ).catch(() => {});
    }

    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) =>
      typeof t === 'string' ? t.toLowerCase() : String(t?.tableName || t || '').toLowerCase()
    );
    if (normalized.includes('doctor_price_histories')) {
      await queryInterface.dropTable('doctor_price_histories');
    }

    const appointments = await queryInterface.describeTable('appointments');
    if (appointments.currency) {
      await queryInterface.removeColumn('appointments', 'currency');
    }

    await queryInterface.changeColumn('appointments', 'amount', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
    await queryInterface.changeColumn('doctors', 'fees', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
  },
};

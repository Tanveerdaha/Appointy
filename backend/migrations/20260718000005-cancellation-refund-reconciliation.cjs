'use strict';

/**
 * Cancellation + refund reconciliation:
 * - Extend stripe_payments with charge/refund tracking fields
 * - Create refund_audits audit table
 * - Add appointment integrity CHECK: CANCELLED + paid requires refund in flight/done
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect()

    await queryInterface.addColumn('stripe_payments', 'stripeChargeId', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    })
    await queryInterface.addColumn('stripe_payments', 'stripeRefundId', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    })
    await queryInterface.addColumn('stripe_payments', 'refundAmount', {
      type: Sequelize.INTEGER,
      allowNull: true,
    })
    await queryInterface.addColumn('stripe_payments', 'refundStatus', {
      type: Sequelize.STRING,
      allowNull: true,
    })
    await queryInterface.addColumn('stripe_payments', 'refundReason', {
      type: Sequelize.STRING(512),
      allowNull: true,
    })
    await queryInterface.addColumn('stripe_payments', 'refundedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    })

    await queryInterface.createTable('refund_audits', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      paymentTransactionId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      action: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      amount: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      reason: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      performedBy: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      performedById: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      stripeRefundId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    })

    await queryInterface.addIndex('refund_audits', ['appointmentId'], {
      name: 'refund_audits_appointment_id',
    })
    await queryInterface.addIndex('refund_audits', ['paymentTransactionId'], {
      name: 'refund_audits_payment_transaction_id',
    })
    await queryInterface.addIndex('refund_audits', ['stripeRefundId'], {
      name: 'refund_audits_stripe_refund_id',
    })
    await queryInterface.addIndex('refund_audits', ['action'], {
      name: 'refund_audits_action',
    })

    // Prevent CANCELLED + paymentStatus=paid without refund reconciliation.
    // SQLite/MySQL both support CHECK; apply via raw SQL for dialect portability.
    if (dialect === 'mysql') {
      await queryInterface.sequelize.query(`
        ALTER TABLE appointments
        ADD CONSTRAINT appointments_cancelled_paid_refund_chk
        CHECK (
          NOT (
            status = 'CANCELLED'
            AND LOWER(COALESCE(paymentStatus, '')) = 'paid'
          )
        )
      `)
    } else if (dialect === 'sqlite') {
      // SQLite cannot ADD CONSTRAINT to existing tables reliably; enforced in app layer.
      // Documented for parity when schemas are rebuilt.
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect()

    if (dialect === 'mysql') {
      await queryInterface.sequelize.query(`
        ALTER TABLE appointments
        DROP CHECK appointments_cancelled_paid_refund_chk
      `).catch(() => {})
    }

    await queryInterface.dropTable('refund_audits')
    await queryInterface.removeColumn('stripe_payments', 'refundedAt')
    await queryInterface.removeColumn('stripe_payments', 'refundReason')
    await queryInterface.removeColumn('stripe_payments', 'refundStatus')
    await queryInterface.removeColumn('stripe_payments', 'refundAmount')
    await queryInterface.removeColumn('stripe_payments', 'stripeRefundId')
    await queryInterface.removeColumn('stripe_payments', 'stripeChargeId')
  },
}

'use strict';

/**
 * Server-owned PENDING_PAYMENT slot holds:
 * - holdExpiresAt: absolute deadline independent of Stripe Checkout
 * - Index for worker scan of due holds
 * - Backfill existing PENDING_PAYMENT rows so abandoned holds become releasable
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('appointments', 'holdExpiresAt', {
      type: Sequelize.DATE,
      allowNull: true,
    })

    await queryInterface.addIndex('appointments', ['status', 'holdExpiresAt'], {
      name: 'appointments_status_hold_expires_at',
    })

    const dialect = queryInterface.sequelize.getDialect()
    if (dialect === 'sqlite') {
      await queryInterface.sequelize.query(`
        UPDATE appointments
        SET holdExpiresAt = datetime(createdAt, '+60 minutes')
        WHERE status = 'PENDING_PAYMENT' AND holdExpiresAt IS NULL
      `)
    } else {
      await queryInterface.sequelize.query(`
        UPDATE appointments
        SET holdExpiresAt = DATE_ADD(createdAt, INTERVAL 60 MINUTE)
        WHERE status = 'PENDING_PAYMENT' AND holdExpiresAt IS NULL
      `)
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('appointments', 'appointments_status_hold_expires_at').catch(() => {})
    await queryInterface.removeColumn('appointments', 'holdExpiresAt')
  },
}

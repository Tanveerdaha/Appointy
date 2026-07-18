'use strict';

/**
 * Failed refund recovery:
 * - Durable retry metadata on stripe_payments
 * - Index for worker scan of due REFUND_FAILED rows
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('stripe_payments', 'refundRetryCount', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    })
    await queryInterface.addColumn('stripe_payments', 'refundNextRetryAt', {
      type: Sequelize.DATE,
      allowNull: true,
    })
    await queryInterface.addColumn('stripe_payments', 'refundLastError', {
      type: Sequelize.STRING(512),
      allowNull: true,
    })

    await queryInterface.addIndex('stripe_payments', ['status', 'refundNextRetryAt'], {
      name: 'stripe_payments_status_next_retry',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('stripe_payments', 'stripe_payments_status_next_retry').catch(() => {})
    await queryInterface.removeColumn('stripe_payments', 'refundLastError')
    await queryInterface.removeColumn('stripe_payments', 'refundNextRetryAt')
    await queryInterface.removeColumn('stripe_payments', 'refundRetryCount')
  },
}

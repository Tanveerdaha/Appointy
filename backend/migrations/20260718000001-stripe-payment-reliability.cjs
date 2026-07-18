'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('appointments', 'stripeCheckoutSessionId', {
      type: Sequelize.STRING,
      allowNull: true,
    })
    await queryInterface.addColumn('appointments', 'stripePaymentIntentId', {
      type: Sequelize.STRING,
      allowNull: true,
    })
    await queryInterface.addColumn('appointments', 'paidAt', {
      type: Sequelize.DATE,
      allowNull: true,
    })

    await queryInterface.addIndex('appointments', ['stripeCheckoutSessionId'], {
      name: 'appointments_stripe_checkout_session_id',
    })
    await queryInterface.addIndex('appointments', ['stripePaymentIntentId'], {
      name: 'appointments_stripe_payment_intent_id',
    })

    await queryInterface.createTable('stripe_webhook_events', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      stripeEventId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      eventType: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      processedAt: {
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
    })

    await queryInterface.addIndex('stripe_webhook_events', ['eventType'])
  },

  async down(queryInterface) {
    await queryInterface.dropTable('stripe_webhook_events')
    await queryInterface.removeIndex('appointments', 'appointments_stripe_payment_intent_id')
    await queryInterface.removeIndex('appointments', 'appointments_stripe_checkout_session_id')
    await queryInterface.removeColumn('appointments', 'paidAt')
    await queryInterface.removeColumn('appointments', 'stripePaymentIntentId')
    await queryInterface.removeColumn('appointments', 'stripeCheckoutSessionId')
  },
}

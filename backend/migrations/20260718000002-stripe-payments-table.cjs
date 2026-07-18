'use strict';

/**
 * Dedicated payment-attempt table so the Stripe payment lifecycle is tracked
 * independently of the appointment row.
 *
 * Duplicate-payment prevention:
 *   - stripe_checkout_session_id UNIQUE  -> one appointment can't map two sessions
 *   - stripe_payment_intent_id  UNIQUE   -> the real payment object is unique
 *   - active_appointment_id     UNIQUE   -> at most ONE active (CREATED/
 *     CHECKOUT_CREATED/PENDING) attempt per appointment. MySQL lacks partial
 *     indexes, so this column mirrors appointment_id only while the attempt is
 *     active and is NULL otherwise; a plain UNIQUE index then behaves like a
 *     partial unique index (NULLs are allowed to repeat).
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stripe_payments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      stripeCheckoutSessionId: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true,
      },
      stripePaymentIntentId: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true,
      },
      checkoutUrl: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      amount: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      currency: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'CREATED',
      },
      activeAppointmentId: {
        type: Sequelize.UUID,
        allowNull: true,
        unique: true,
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      paidAt: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await queryInterface.addIndex('stripe_payments', ['appointmentId'], {
      name: 'stripe_payments_appointment_id',
    })
    await queryInterface.addIndex('stripe_payments', ['userId'], {
      name: 'stripe_payments_user_id',
    })
    await queryInterface.addIndex('stripe_payments', ['status'], {
      name: 'stripe_payments_status',
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('stripe_payments')
  },
}

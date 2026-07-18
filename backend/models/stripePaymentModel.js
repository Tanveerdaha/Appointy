import { DataTypes } from 'sequelize'
import sequelize from '../config/mysql.js'

export const PAYMENT_STATUS = {
  CREATED: 'CREATED',
  CHECKOUT_CREATED: 'CHECKOUT_CREATED',
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'REFUNDED',
}

// Statuses that represent an in-flight, unpaid attempt. At most one of these may
// exist per appointment at any time (enforced via the activeAppointmentId index).
export const ACTIVE_PAYMENT_STATUSES = [
  PAYMENT_STATUS.CREATED,
  PAYMENT_STATUS.CHECKOUT_CREATED,
  PAYMENT_STATUS.PENDING,
]

const StripePayment = sequelize.define('StripePayment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  appointmentId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  stripeCheckoutSessionId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  stripePaymentIntentId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  checkoutUrl: {
    type: DataTypes.STRING(2048),
    allowNull: true,
  },
  // Stored in the currency minor unit (e.g. cents) to match Stripe amount_total.
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  currency: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: PAYMENT_STATUS.CREATED,
  },
  // Partial-unique emulation: mirrors appointmentId while the attempt is active,
  // NULL otherwise. A UNIQUE index on this column guarantees a single active
  // (CREATED/CHECKOUT_CREATED/PENDING) payment per appointment even on MySQL,
  // which lacks partial indexes. Managed by the beforeValidate hook below.
  activeAppointmentId: {
    type: DataTypes.UUID,
    allowNull: true,
    unique: true,
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  paidAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'stripe_payments',
  timestamps: true,
  indexes: [
    { fields: ['appointmentId'] },
    { fields: ['userId'] },
    { fields: ['status'] },
    { unique: true, fields: ['stripeCheckoutSessionId'] },
    { unique: true, fields: ['stripePaymentIntentId'] },
    { unique: true, fields: ['activeAppointmentId'] },
  ],
  hooks: {
    beforeValidate: (payment) => {
      const isActive = ACTIVE_PAYMENT_STATUSES.includes(payment.status)
      payment.activeAppointmentId = isActive ? payment.appointmentId : null
    },
  },
})

export default StripePayment

import { DataTypes } from 'sequelize'
import sequelize from '../config/mysql.js'

export const REFUND_AUDIT_ACTION = {
  PATIENT_REQUESTED: 'PATIENT_REQUESTED',
  DOCTOR_UNAVAILABLE: 'DOCTOR_UNAVAILABLE',
  ADMIN_CANCELLED: 'ADMIN_CANCELLED',
  AUTO_CANCELLED: 'AUTO_CANCELLED',
  REFUND_CREATED: 'REFUND_CREATED',
  REFUND_SUCCEEDED: 'REFUND_SUCCEEDED',
  REFUND_FAILED: 'REFUND_FAILED',
  REFUND_DUPLICATE_BLOCKED: 'REFUND_DUPLICATE_BLOCKED',
}

const RefundAudit = sequelize.define('RefundAudit', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  appointmentId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  paymentTransactionId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  action: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  reason: {
    type: DataTypes.STRING(512),
    allowNull: true,
  },
  performedBy: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  performedById: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  stripeRefundId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'refund_audits',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['appointmentId'], name: 'refund_audits_appointment_id' },
    { fields: ['paymentTransactionId'], name: 'refund_audits_payment_transaction_id' },
    { fields: ['stripeRefundId'], name: 'refund_audits_stripe_refund_id' },
    { fields: ['action'], name: 'refund_audits_action' },
  ],
})

export default RefundAudit

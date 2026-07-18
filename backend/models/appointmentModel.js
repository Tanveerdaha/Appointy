import { DataTypes } from 'sequelize';
import sequelize from '../config/mysql.js';

const Appointment = sequelize.define('Appointment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  docId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  /** Canonical absolute start of the appointment (source of truth). */
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  /**
   * Equals startTime while the slot is held; NULL when cancelled/refunded.
   * UNIQUE(docId, heldStartTime) enforces one active booking per doctor/time.
   */
  heldStartTime: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  /**
   * Scheduling lifecycle. Availability uses SLOT_HOLDING_STATUSES in appointmentService.
   * Kept in sync with cancelled / isCompleted for backward compatibility.
   */
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'CONFIRMED',
  },
  /** @deprecated Prefer startTime — kept for display/back-compat. */
  slotDate: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  /** @deprecated Prefer startTime — kept for display/back-compat. */
  slotTime: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  userData: {
    type: DataTypes.JSON,
    allowNull: false,
  },
  docData: {
    type: DataTypes.JSON,
    allowNull: false,
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  date: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  cancelled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  payment: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  paymentStatus: {
    type: DataTypes.STRING,
    defaultValue: 'unpaid',
  },
  stripeCheckoutSessionId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  stripePaymentIntentId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  paidAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  isCompleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'appointments',
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['docId'] },
    { fields: ['paymentStatus'] },
    { fields: ['stripeCheckoutSessionId'] },
    { fields: ['stripePaymentIntentId'] },
    { fields: ['status'] },
    { fields: ['startTime'] },
    {
      unique: true,
      fields: ['docId', 'heldStartTime'],
      name: 'unique_doctor_slot',
    },
  ],
});

export default Appointment;

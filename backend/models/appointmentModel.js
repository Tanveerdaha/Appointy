import { DataTypes } from 'sequelize';
import sequelize from '../config/mysql.js';

export const APPOINTMENT_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
};

/** Statuses that occupy a doctor slot. */
export const SLOT_HOLDING_STATUSES = [
  APPOINTMENT_STATUS.PENDING_PAYMENT,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.COMPLETED,
];

export const APPOINTMENT_STATUS_VALUES = Object.values(APPOINTMENT_STATUS);

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
   * Equals startTime while the slot is held; NULL when cancelled/no-show.
   * UNIQUE(docId, heldStartTime) enforces one active booking per doctor/time.
   */
  heldStartTime: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  /**
   * Scheduling lifecycle (source of truth).
   * Kept in sync with cancelled / isCompleted for backward compatibility.
   */
  status: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: APPOINTMENT_STATUS.CONFIRMED,
    validate: {
      isIn: [APPOINTMENT_STATUS_VALUES],
    },
  },
  statusChangedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  cancelledAt: {
    type: DataTypes.DATE,
    allowNull: true,
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
  /**
   * Immutable fee snapshot at booking time (major currency units).
   * Never re-read from doctor.fees after creation — doctor prices may change.
   */
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0.01,
    },
  },
  /** Canonical ISO currency for amount (e.g. PKR). */
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'PKR',
  },
  date: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  /** @deprecated Prefer status — kept for backward compatibility. */
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
  /** @deprecated Prefer status — kept for backward compatibility. */
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
    { fields: ['docId', 'status', 'startTime'], name: 'appointments_doc_status_start_time' },
    { fields: ['userId', 'status'], name: 'appointments_user_status' },
    {
      unique: true,
      fields: ['docId', 'heldStartTime'],
      name: 'unique_doctor_slot',
    },
  ],
});

export default Appointment;

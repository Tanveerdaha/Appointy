import { DataTypes } from 'sequelize'
import sequelize from '../config/mysql.js'

export const HISTORY_OUTCOME = {
  SUCCEEDED: 'SUCCEEDED',
  REJECTED: 'REJECTED',
}

export const ACTOR_TYPE = {
  USER: 'USER',
  DOCTOR: 'DOCTOR',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
  MIGRATION: 'MIGRATION',
}

const AppointmentHistory = sequelize.define('AppointmentHistory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  appointmentId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  oldStatus: {
    type: DataTypes.STRING(32),
    allowNull: true,
  },
  newStatus: {
    type: DataTypes.STRING(32),
    allowNull: false,
  },
  outcome: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: HISTORY_OUTCOME.SUCCEEDED,
  },
  actorType: {
    type: DataTypes.STRING(16),
    allowNull: false,
  },
  actorId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  reason: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  errorCode: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  occurredAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'appointment_histories',
  timestamps: true,
  indexes: [
    { fields: ['appointmentId', 'occurredAt'], name: 'appointment_histories_appointment_occurred_at' },
    { fields: ['newStatus', 'occurredAt'], name: 'appointment_histories_new_status_occurred_at' },
    { fields: ['outcome'], name: 'appointment_histories_outcome' },
  ],
})

export default AppointmentHistory

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
  slotDate: {
    type: DataTypes.STRING,
    allowNull: false,
  },
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
  ],
});

export default Appointment;
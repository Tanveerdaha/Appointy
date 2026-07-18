import { DataTypes } from 'sequelize'
import sequelize from '../config/mysql.js'

const DoctorPriceHistory = sequelize.define('DoctorPriceHistory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  doctorId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  oldFee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  newFee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  changedBy: {
    type: DataTypes.STRING(128),
    allowNull: false,
  },
  changedByRole: {
    type: DataTypes.STRING(32),
    allowNull: false,
  },
}, {
  tableName: 'doctor_price_histories',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['doctorId'], name: 'doctor_price_histories_doctor_id' },
    { fields: ['changedBy'], name: 'doctor_price_histories_changed_by' },
    { fields: ['createdAt'], name: 'doctor_price_histories_created_at' },
  ],
})

export default DoctorPriceHistory

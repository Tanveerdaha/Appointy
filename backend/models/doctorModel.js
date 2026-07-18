import { DataTypes } from 'sequelize';
import sequelize from '../config/mysql.js';

const MIN_FEE = Number(process.env.MIN_APPOINTMENT_FEE || 100);
const MAX_FEE = Number(process.env.MAX_APPOINTMENT_FEE || 1000000);

const Doctor = sequelize.define('Doctor', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // Cloudinary URL — VARCHAR (MySQL TEXT columns cannot have DEFAULT)
  image: {
    type: DataTypes.STRING(2048),
    allowNull: false,
  },
  speciality: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  degree: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  experience: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  about: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  available: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  fees: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: MIN_FEE,
      max: MAX_FEE,
      isPositive(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error('Invalid appointment fee');
        }
      },
    },
  },
  slots_booked: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  address: {
    type: DataTypes.JSON,
    allowNull: false,
  },
  date: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
}, {
  tableName: 'doctors',
  timestamps: true,
  defaultScope: {
    attributes: { exclude: ['password'] },
  },
  hooks: {
    beforeValidate(doctor) {
      if (doctor.slots_booked == null) {
        doctor.slots_booked = {};
      }
    },
  },
});

export default Doctor;

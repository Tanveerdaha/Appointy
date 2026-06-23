import { DataTypes } from 'sequelize';
import sequelize from '../config/mysql.js';

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
  image: {
    type: DataTypes.TEXT('long'),
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
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  slots_booked: {
    type: DataTypes.JSON,
    defaultValue: {},
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
});

export default Doctor;
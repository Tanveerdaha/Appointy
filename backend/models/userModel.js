import { DataTypes } from 'sequelize';
import sequelize from '../config/mysql.js';

const User = sequelize.define('User', {
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
  image: {
    type: DataTypes.TEXT('long'),
    defaultValue: '',
  },
  phone: {
    type: DataTypes.STRING,
    defaultValue: '000000000',
  },
  address: {
    type: DataTypes.JSON,
    defaultValue: { line1: '', line2: '' },
  },
  gender: {
    type: DataTypes.STRING,
    defaultValue: 'Not Selected',
  },
  dob: {
    type: DataTypes.STRING,
    defaultValue: 'Not Selected',
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, {
  tableName: 'users',
  timestamps: true,
});

export default User;

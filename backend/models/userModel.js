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
  // Cloudinary URL — VARCHAR (MySQL TEXT columns cannot have DEFAULT)
  image: {
    type: DataTypes.STRING(2048),
    allowNull: false,
    defaultValue: '',
  },
  phone: {
    type: DataTypes.STRING,
    defaultValue: '000000000',
  },
  address: {
    type: DataTypes.JSON,
    allowNull: true,
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
  resetToken: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  resetTokenExpiry: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
}, {
  tableName: 'users',
  timestamps: true,
  defaultScope: {
    attributes: { exclude: ['password', 'resetToken', 'resetTokenExpiry'] },
  },
  hooks: {
    beforeValidate(user) {
      if (user.address == null) {
        user.address = { line1: '', line2: '' };
      }
      if (user.image == null) {
        user.image = '';
      }
    },
  },
});

export default User;

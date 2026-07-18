import { DataTypes } from 'sequelize'
import sequelize from '../config/mysql.js'

const RefreshToken = sequelize.define('RefreshToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING(128),
    allowNull: false,
  },
  tokenHash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
  },
  role: {
    type: DataTypes.STRING(32),
    allowNull: false,
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  revokedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'refresh_tokens',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['userId', 'role'], name: 'refresh_tokens_user_role' },
    { fields: ['expiresAt'], name: 'refresh_tokens_expires_at' },
    { fields: ['revokedAt'], name: 'refresh_tokens_revoked_at' },
  ],
})

export default RefreshToken

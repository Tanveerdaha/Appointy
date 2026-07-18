import { DataTypes } from 'sequelize'
import sequelize from '../config/mysql.js'

const StripeWebhookEvent = sequelize.define('StripeWebhookEvent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  stripeEventId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  eventType: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  processedAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
}, {
  tableName: 'stripe_webhook_events',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['stripeEventId'] },
    { fields: ['eventType'] },
  ],
})

export default StripeWebhookEvent

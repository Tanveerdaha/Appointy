import User from './userModel.js'
import Doctor from './doctorModel.js'
import Appointment from './appointmentModel.js'
import StripeWebhookEvent from './stripeWebhookEventModel.js'
import StripePayment from './stripePaymentModel.js'

User.hasMany(Appointment, { foreignKey: 'userId', onDelete: 'RESTRICT' })
Doctor.hasMany(Appointment, { foreignKey: 'docId', onDelete: 'RESTRICT' })
Appointment.belongsTo(User, { foreignKey: 'userId' })
Appointment.belongsTo(Doctor, { foreignKey: 'docId' })

Appointment.hasMany(StripePayment, { foreignKey: 'appointmentId', onDelete: 'RESTRICT' })
StripePayment.belongsTo(Appointment, { foreignKey: 'appointmentId' })
User.hasMany(StripePayment, { foreignKey: 'userId', onDelete: 'RESTRICT' })
StripePayment.belongsTo(User, { foreignKey: 'userId' })

export { User, Doctor, Appointment, StripeWebhookEvent, StripePayment }

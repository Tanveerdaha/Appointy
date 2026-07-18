import User from './userModel.js'
import Doctor from './doctorModel.js'
import Appointment from './appointmentModel.js'
import AppointmentHistory from './appointmentHistoryModel.js'
import StripeWebhookEvent from './stripeWebhookEventModel.js'
import StripePayment from './stripePaymentModel.js'
import RefundAudit from './refundAuditModel.js'
import RefreshToken from './refreshTokenModel.js'
import DoctorPriceHistory from './doctorPriceHistoryModel.js'

User.hasMany(Appointment, { foreignKey: 'userId', onDelete: 'RESTRICT' })
Doctor.hasMany(Appointment, { foreignKey: 'docId', onDelete: 'RESTRICT' })
Appointment.belongsTo(User, { foreignKey: 'userId' })
Appointment.belongsTo(Doctor, { foreignKey: 'docId' })

Appointment.hasMany(StripePayment, { foreignKey: 'appointmentId', onDelete: 'RESTRICT' })
StripePayment.belongsTo(Appointment, { foreignKey: 'appointmentId' })
User.hasMany(StripePayment, { foreignKey: 'userId', onDelete: 'RESTRICT' })
StripePayment.belongsTo(User, { foreignKey: 'userId' })

Appointment.hasMany(AppointmentHistory, { foreignKey: 'appointmentId', onDelete: 'RESTRICT' })
AppointmentHistory.belongsTo(Appointment, { foreignKey: 'appointmentId' })

Appointment.hasMany(RefundAudit, { foreignKey: 'appointmentId', constraints: false })
RefundAudit.belongsTo(Appointment, { foreignKey: 'appointmentId', constraints: false })
StripePayment.hasMany(RefundAudit, { foreignKey: 'paymentTransactionId', constraints: false })
RefundAudit.belongsTo(StripePayment, { foreignKey: 'paymentTransactionId', constraints: false })

Doctor.hasMany(DoctorPriceHistory, { foreignKey: 'doctorId', onDelete: 'CASCADE' })
DoctorPriceHistory.belongsTo(Doctor, { foreignKey: 'doctorId' })

export {
  User,
  Doctor,
  Appointment,
  AppointmentHistory,
  StripeWebhookEvent,
  StripePayment,
  RefundAudit,
  RefreshToken,
  DoctorPriceHistory,
}

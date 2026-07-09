import User from './userModel.js'
import Doctor from './doctorModel.js'
import Appointment from './appointmentModel.js'

User.hasMany(Appointment, { foreignKey: 'userId', onDelete: 'RESTRICT' })
Doctor.hasMany(Appointment, { foreignKey: 'docId', onDelete: 'RESTRICT' })
Appointment.belongsTo(User, { foreignKey: 'userId' })
Appointment.belongsTo(Doctor, { foreignKey: 'docId' })

export { User, Doctor, Appointment }

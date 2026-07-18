import express from 'express';
import { loginDoctor, refreshDoctorToken, logoutDoctor, appointmentsDoctor, appointmentCancel, doctorList,  appointmentComplete, doctorDashboard, doctorProfile, updateDoctorProfile, changeAvailability } from '../controllers/doctorController.js';
import authDoctor from '../middlewares/authDoctor.js';
import requireRole from '../middlewares/requireRole.js';
import { JWT_ROLES } from '../services/jwtService.js';

const doctorRouter = express.Router();

doctorRouter.post("/login", loginDoctor)
doctorRouter.post("/refresh", refreshDoctorToken)
doctorRouter.post("/logout", logoutDoctor)
doctorRouter.post("/cancel-appointment", authDoctor, requireRole(JWT_ROLES.DOCTOR), appointmentCancel)
doctorRouter.get("/appointments", authDoctor, requireRole(JWT_ROLES.DOCTOR), appointmentsDoctor)
doctorRouter.get("/list", doctorList)
doctorRouter.post("/change-availability", authDoctor, requireRole(JWT_ROLES.DOCTOR), changeAvailability)
doctorRouter.post("/complete-appointment", authDoctor, requireRole(JWT_ROLES.DOCTOR), appointmentComplete)
doctorRouter.get("/dashboard", authDoctor, requireRole(JWT_ROLES.DOCTOR), doctorDashboard)
doctorRouter.get("/profile", authDoctor, requireRole(JWT_ROLES.DOCTOR), doctorProfile)
doctorRouter.post("/update-profile", authDoctor, requireRole(JWT_ROLES.DOCTOR), updateDoctorProfile)

export default doctorRouter;

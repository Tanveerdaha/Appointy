import express from 'express'
import { addDoctor, adminDashboard, allDoctors, appointmentCancel, retryRefund, appointmentsAdmin, loginAdmin, refreshAdminToken, logoutAdmin, appointmentComplete, updateDoctor, deleteDoctor, listUsers, changeAvailability } from '../controllers/adminController.js'
import upload from '../middlewares/multer.js'
import authAdmin from '../middlewares/authAdmin.js'
import requireRole from '../middlewares/requireRole.js'
import { JWT_ROLES } from '../services/jwtService.js'
import { validateRetryRefundBody } from '../middlewares/validateAppointment.js'

const adminRouter = express.Router();

adminRouter.post("/login", loginAdmin)
adminRouter.post("/refresh", refreshAdminToken)
adminRouter.post("/logout", logoutAdmin)
adminRouter.post("/add-doctor", authAdmin, requireRole(JWT_ROLES.ADMIN), upload.single('image'), addDoctor)
adminRouter.get("/all-doctors", authAdmin, requireRole(JWT_ROLES.ADMIN), allDoctors)
adminRouter.get("/users", authAdmin, requireRole(JWT_ROLES.ADMIN), listUsers)
adminRouter.post("/change-availability", authAdmin, requireRole(JWT_ROLES.ADMIN), changeAvailability)
adminRouter.get("/appointments", authAdmin, requireRole(JWT_ROLES.ADMIN), appointmentsAdmin)
adminRouter.post("/cancel-appointment", authAdmin, requireRole(JWT_ROLES.ADMIN), appointmentCancel)
adminRouter.post("/retry-refund", authAdmin, requireRole(JWT_ROLES.ADMIN), validateRetryRefundBody, retryRefund)
adminRouter.post("/complete-appointment", authAdmin, requireRole(JWT_ROLES.ADMIN), appointmentComplete)
adminRouter.post("/update-doctor", authAdmin, requireRole(JWT_ROLES.ADMIN), upload.single('image'), updateDoctor)
adminRouter.post("/delete-doctor", authAdmin, requireRole(JWT_ROLES.ADMIN), deleteDoctor)
adminRouter.get("/dashboard", authAdmin, requireRole(JWT_ROLES.ADMIN), adminDashboard)

export default adminRouter;

import express from 'express';
import {
    registerUser, loginUser, refreshUserToken, logoutUser, getProfile, updateProfile, bookAppointment,
    listAppointment, cancelAppointment, paymentStripe, paymentStatus, verifyStripe,
    rescheduleAppointment, forgotPassword, resetPassword, contactUs,
} from '../controllers/userController.js';
import authUser from '../middlewares/authUser.js';
import requireRole from '../middlewares/requireRole.js';
import upload from '../middlewares/multer.js';
import { validateBookAppointmentBody, validateRescheduleBody } from '../middlewares/validateAppointment.js';
import { JWT_ROLES } from '../services/jwtService.js';

const userRouter = express.Router();

userRouter.post("/register", registerUser)
userRouter.post("/login", loginUser)
userRouter.post("/refresh", refreshUserToken)
userRouter.post("/logout", logoutUser)
userRouter.post("/forgot-password", forgotPassword)
userRouter.post("/reset-password", resetPassword)
userRouter.post("/contact", contactUs)
userRouter.get("/get-profile", authUser, requireRole(JWT_ROLES.PATIENT), getProfile)
userRouter.post("/update-profile", authUser, requireRole(JWT_ROLES.PATIENT), upload.single('image'), updateProfile)
userRouter.post("/book-appointment", authUser, requireRole(JWT_ROLES.PATIENT), validateBookAppointmentBody, bookAppointment)
userRouter.get("/appointments", authUser, requireRole(JWT_ROLES.PATIENT), listAppointment)
userRouter.post("/cancel-appointment", authUser, requireRole(JWT_ROLES.PATIENT), cancelAppointment)
userRouter.post("/payment-stripe", authUser, requireRole(JWT_ROLES.PATIENT), paymentStripe)
userRouter.get("/payment-status/:appointmentId", authUser, requireRole(JWT_ROLES.PATIENT), paymentStatus)
userRouter.post("/verify-stripe", authUser, requireRole(JWT_ROLES.PATIENT), verifyStripe)
userRouter.post("/reschedule-appointment", authUser, requireRole(JWT_ROLES.PATIENT), validateRescheduleBody, rescheduleAppointment)

export default userRouter;

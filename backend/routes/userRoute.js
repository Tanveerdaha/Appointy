import express from 'express';
import {
    registerUser, loginUser, getProfile, updateProfile, bookAppointment,
    listAppointment, cancelAppointment, paymentStripe, paymentStatus, verifyStripe,
    rescheduleAppointment, forgotPassword, resetPassword, contactUs,
} from '../controllers/userController.js';
import authUser from '../middlewares/authUser.js';
import upload from '../middlewares/multer.js';

const userRouter = express.Router();

userRouter.post("/register", registerUser)
userRouter.post("/login", loginUser)
userRouter.post("/forgot-password", forgotPassword)
userRouter.post("/reset-password", resetPassword)
userRouter.post("/contact", contactUs)
userRouter.get("/get-profile", authUser, getProfile)
userRouter.post("/update-profile", authUser, upload.single('image'), updateProfile)
userRouter.post("/book-appointment", authUser, bookAppointment)
userRouter.get("/appointments", authUser, listAppointment)
userRouter.post("/cancel-appointment", authUser, cancelAppointment)
userRouter.post("/payment-stripe", authUser, paymentStripe)
userRouter.get("/payment-status/:appointmentId", authUser, paymentStatus)
userRouter.post("/verify-stripe", authUser, verifyStripe)
userRouter.post("/reschedule-appointment", authUser, rescheduleAppointment)

export default userRouter;

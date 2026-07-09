import express from 'express'
import { addDoctor, adminDashboard, allDoctors, appointmentCancel, appointmentsAdmin, loginAdmin, appointmentComplete, updateDoctor, deleteDoctor, listUsers } from '../controllers/adminController.js'
import upload from '../middlewares/multer.js'
import authAdmin from '../middlewares/authAdmin.js';
import { changeAvailability } from '../controllers/doctorController.js';

const adminRouter = express.Router();

adminRouter.post("/login", loginAdmin)
adminRouter.post("/add-doctor", authAdmin, upload.single('image'), addDoctor)
adminRouter.get("/all-doctors", authAdmin, allDoctors)
adminRouter.get("/users", authAdmin, listUsers)
adminRouter.post("/change-availability", authAdmin, changeAvailability)
adminRouter.get("/appointments", authAdmin, appointmentsAdmin)
adminRouter.post("/cancel-appointment", authAdmin, appointmentCancel)
adminRouter.post("/complete-appointment", authAdmin, appointmentComplete)
adminRouter.post("/update-doctor", authAdmin, upload.single('image'), updateDoctor)
adminRouter.post("/delete-doctor", authAdmin, deleteDoctor)
adminRouter.get("/dashboard", authAdmin, adminDashboard)

export default adminRouter;

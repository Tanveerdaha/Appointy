import jwt from "jsonwebtoken";
import { Op } from "sequelize";
import Appointment from "../models/appointmentModel.js";
import Doctor from "../models/doctorModel.js";
import bcrypt from "bcrypt";
import validator from "validator";
import { uploadImage } from "../utils/uploadImage.js";
import User from "../models/userModel.js"
import { verifyAdminPassword } from "../middlewares/authAdmin.js";
import { notifyAppointmentCancelled } from "../services/notificationService.js";
import {
  cancelAppointment as cancelAppointmentLifecycle,
  completeAppointment as completeAppointmentLifecycle,
  LifecycleError,
  ACTOR_TYPE,
  APPOINTMENT_STATUS,
} from "../services/appointmentStateService.js";

// API for admin login
const loginAdmin = async (req, res) => {
    try {
        const { email, password } = req.body

        if (email === process.env.ADMIN_EMAIL && await verifyAdminPassword(password)) {
            const token = jwt.sign({ role: 'admin', email }, process.env.JWT_SECRET, { expiresIn: '7d' })
            res.json({ success: true, token })
        } else {
            res.status(401).json({ success: false, message: "Invalid credentials" })
        }

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

// API for adding Doctor
const addDoctor = async (req, res) => {
  try {
    const { name, email, password, speciality, degree, experience, about, fees, address } = req.body;
    const imageFile = req.file;

    if (!name || !email || !password || !speciality || !degree || !experience || !about || !fees || !address) {
      return res.status(400).json({ success: false, message: "Missing Details" });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email" });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Please enter a strong password" });
    }

    if (!imageFile) {
      return res.status(400).json({ success: false, message: "Doctor image is required" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const imageUrl = await uploadImage(imageFile);

    let parsedAddress;
    try {
      parsedAddress = JSON.parse(address);
    } catch {
      return res.status(400).json({ success: false, message: "Invalid address format" });
    }

    const doctorData = {
      name,
      email,
      image: imageUrl,
      password: hashedPassword,
      speciality,
      degree,
      experience,
      about,
      fees,
      address: parsedAddress,
      date: Date.now()
    };

    await Doctor.create(doctorData);

    res.status(200).json({ success: true, message: "Doctor Added" });

  } catch (error) {
    console.error("Error adding doctor:", error);
    res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

// API for appointment cancellation
const appointmentCancel = async (req, res) => {
    try {
        const { appointmentId } = req.body
        const appointmentData = await Appointment.findByPk(appointmentId)

        if (!appointmentData) {
            return res.status(404).json({ success: false, message: 'Appointment not found' })
        }

        if (appointmentData.status === APPOINTMENT_STATUS.CANCELLED) {
            return res.status(400).json({ success: false, message: 'Appointment already cancelled' })
        }

        await cancelAppointmentLifecycle(appointmentData.id, {
            actorType: ACTOR_TYPE.ADMIN,
            reason: 'Cancelled by admin',
        })

        notifyAppointmentCancelled(appointmentData, appointmentData.userData?.email).catch(console.error)

        res.json({ success: true, message: 'Appointment Cancelled' })

    } catch (error) {
        if (error instanceof LifecycleError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
                code: error.code,
            })
        }
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const allDoctors = async (req, res) => {
    try {
        const doctors = await Doctor.findAll()
        res.json({ success: true, doctors })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API to get all appointments list
const appointmentsAdmin = async (req, res) => {
    try {
        const appointments = await Appointment.findAll()
        res.json({ success: true, appointments })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API to get dashboard data for admin panel
const adminDashboard = async (req, res) => {
    try {
        const [doctors, patients, appointments, revenue, paidAppointments, latestAppointments] = await Promise.all([
            Doctor.count(),
            User.count(),
            Appointment.count(),
            Appointment.sum('amount', {
                where: {
                    status: { [Op.ne]: APPOINTMENT_STATUS.CANCELLED },
                    paymentStatus: 'paid',
                },
            }),
            Appointment.count({
                where: {
                    status: { [Op.ne]: APPOINTMENT_STATUS.CANCELLED },
                    paymentStatus: 'paid',
                },
            }),
            Appointment.findAll({
                order: [['createdAt', 'DESC']],
                limit: 5,
            }),
        ])

        const dashData = {
            doctors,
            appointments,
            patients,
            revenue: revenue || 0,
            paidAppointments,
            latestAppointments,
        }

        res.json({ success: true, dashData })

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

// API to mark appointment complete
const appointmentComplete = async (req, res) => {
    try {
        const { appointmentId } = req.body
        const appointment = await Appointment.findByPk(appointmentId)

        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' })
        }

        await completeAppointmentLifecycle(appointment.id, {
            actorType: ACTOR_TYPE.ADMIN,
            reason: 'Completed by admin',
        })
        res.json({ success: true, message: 'Appointment Completed' })
    } catch (error) {
        if (error instanceof LifecycleError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
                code: error.code,
            })
        }
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

// API to update doctor
const updateDoctor = async (req, res) => {
    try {
        const { docId, name, email, speciality, degree, experience, about, fees, address } = req.body
        const imageFile = req.file

        if (!docId) {
            return res.status(400).json({ success: false, message: 'Doctor ID required' })
        }

        const doctor = await Doctor.findByPk(docId)
        if (!doctor) {
            return res.status(404).json({ success: false, message: 'Doctor not found' })
        }

        const updateData = {}
        if (name) updateData.name = name
        if (email) {
            if (!validator.isEmail(email)) {
                return res.status(400).json({ success: false, message: 'Please enter a valid email' })
            }
            updateData.email = email
        }
        if (speciality) updateData.speciality = speciality
        if (degree) updateData.degree = degree
        if (experience) updateData.experience = experience
        if (about) updateData.about = about
        if (fees) updateData.fees = fees
        if (address) {
            try {
                updateData.address = typeof address === 'string' ? JSON.parse(address) : address
            } catch {
                return res.status(400).json({ success: false, message: 'Invalid address format' })
            }
        }
        if (imageFile) {
            updateData.image = await uploadImage(imageFile)
        }

        await Doctor.update(updateData, { where: { id: docId } })
        res.json({ success: true, message: 'Doctor Updated' })
    } catch (error) {
        console.error('Error updating doctor:', error)
        res.status(500).json({ success: false, message: error.message || 'Internal Server Error' })
    }
}

// API to list all patients (read-only)
const listUsers = async (req, res) => {
    try {
        const users = await User.findAll({
            attributes: { exclude: ['password', 'resetToken', 'resetTokenExpiry'] },
            order: [['createdAt', 'DESC']],
        })
        res.json({ success: true, users })
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

// API to delete doctor
const deleteDoctor = async (req, res) => {
    try {
        const { docId } = req.body

        if (!docId) {
            return res.status(400).json({ success: false, message: 'Doctor ID required' })
        }

        const activeAppointments = await Appointment.count({
            where: {
                docId,
                status: { [Op.in]: [APPOINTMENT_STATUS.PENDING_PAYMENT, APPOINTMENT_STATUS.CONFIRMED] },
            },
        })

        if (activeAppointments > 0) {
            return res.json({ success: false, message: 'Doctor has active appointments. Cancel them first or mark unavailable.' })
        }

        await Doctor.destroy({ where: { id: docId } })
        res.json({ success: true, message: 'Doctor Deleted' })
    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

export {loginAdmin, addDoctor, allDoctors, appointmentsAdmin, appointmentCancel, adminDashboard, appointmentComplete, updateDoctor, deleteDoctor, listUsers}

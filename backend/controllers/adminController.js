import jwt from "jsonwebtoken";
import Appointment from "../models/appointmentModel.js";
import Doctor from "../models/doctorModel.js";
import bcrypt from "bcrypt";
import validator from "validator";
import { uploadImage } from "../utils/uploadImage.js";
import User from "../models/userModel.js"
import { verifyAdminPassword } from "../middlewares/authAdmin.js";
import { notifyAppointmentCancelled } from "../services/notificationService.js";

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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const imageUrl = imageFile ? await uploadImage(imageFile) : '';

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
            return res.json({ success: false, message: 'Appointment not found' })
        }

        await Appointment.update({ cancelled: true }, { where: { id: appointmentId } })

        // releasing doctor slot 
        const { docId, slotDate, slotTime } = appointmentData

        const doctorData = await Doctor.findByPk(docId)

        if (doctorData) {
            let slots_booked = doctorData.slots_booked || {}

            if (slots_booked[slotDate]) {
                slots_booked[slotDate] = slots_booked[slotDate].filter(e => e !== slotTime)
            }

            await Doctor.update({ slots_booked }, { where: { id: docId } })
        }

        notifyAppointmentCancelled(appointmentData, appointmentData.userData?.email).catch(console.error)

        res.json({ success: true, message: 'Appointment Cancelled' })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

const allDoctors = async (req, res) => {
    try {
        const doctors = await Doctor.findAll({
            attributes: { exclude: ['password'] }
        })
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
        const doctors = await Doctor.findAll()
        const users = await User.findAll()
        const appointments = await Appointment.findAll()

        const paidAppointments = appointments.filter(a => {
            const status = a.paymentStatus || (a.payment ? 'paid' : 'unpaid')
            return status === 'paid' && !a.cancelled
        })
        const revenue = paidAppointments.reduce((sum, a) => sum + (a.amount || 0), 0)

        const dashData = {
            doctors: doctors.length,
            appointments: appointments.length,
            patients: users.length,
            revenue,
            paidAppointments: paidAppointments.length,
            latestAppointments: [...appointments].reverse().slice(0, 5)
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
            return res.json({ success: false, message: 'Appointment not found' })
        }

        if (appointment.cancelled) {
            return res.json({ success: false, message: 'Cannot complete a cancelled appointment' })
        }

        await Appointment.update({ isCompleted: true }, { where: { id: appointmentId } })
        res.json({ success: true, message: 'Appointment Completed' })
    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
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
            where: { docId, cancelled: false, isCompleted: false }
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

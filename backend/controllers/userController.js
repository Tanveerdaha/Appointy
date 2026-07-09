import validator from 'validator'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import User from "../models/userModel.js";
import Doctor from "../models/doctorModel.js";
import Appointment from "../models/appointmentModel.js";
import jwt from "jsonwebtoken";
import razorpay from 'razorpay';
import { uploadImage } from '../utils/uploadImage.js';
import sequelize from '../config/mysql.js';
import { lockDoctorForUpdate } from '../utils/lockDoctor.js';
import { notifyAppointmentBooked, notifyAppointmentCancelled, notifyPasswordReset } from '../services/notificationService.js';

const JWT_OPTIONS = { expiresIn: '7d' }

const getRazorpayInstance = () => {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay credentials not configured')
    }
    return new razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    })
}

const createRazorpayOrder = async (appointment) => {
    const razorpayInstance = getRazorpayInstance()
    const options = {
        amount: appointment.amount * 100,
        currency: process.env.CURRENCY || 'INR',
        receipt: appointment.id,
    }
    return razorpayInstance.orders.create(options)
}

const syncPaymentFields = (appointment) => {
    const status = appointment.paymentStatus || (appointment.payment ? 'paid' : 'unpaid')
    return { ...appointment.toJSON?.() ?? appointment, paymentStatus: status, payment: status === 'paid' }
}

const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Missing Details' })
        }

        if (!validator.isEmail(email)) {
            return res.status(400).json({ success: false, message: "Please enter a valid email" })
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, message: "Please enter a strong password" })
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt)

        const user = await User.create({ name, email, password: hashedPassword })

        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, JWT_OPTIONS)
        res.json({ success: true, token })

    } catch (error) {
        console.log(error)
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ success: false, message: 'Email already registered' })
        }
        res.status(500).json({ success: false, message: error.message })
    }
}

const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ where: { email } })

        if (!user) {
            return res.status(404).json({ success: false, message: "User does not exist" })
        }

        const isMatch = await bcrypt.compare(password, user.password)

        if (isMatch) {
            const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, JWT_OPTIONS)
            res.json({ success: true, token })
        } else {
            res.status(401).json({ success: false, message: "Invalid credentials" })
        }
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const getProfile = async (req, res) => {
    try {
        const userId = req.userId
        const userData = await User.findByPk(userId, {
            attributes: { exclude: ['password', 'resetToken', 'resetTokenExpiry'] }
        })

        res.json({ success: true, userData })

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const updateProfile = async (req, res) => {
    try {
        const userId = req.userId
        const { name, phone, address, dob, gender } = req.body
        const imageFile = req.file

        if (!name) {
            return res.status(400).json({ success: false, message: "Name is required" })
        }

        let parsedAddress = { line1: '', line2: '' }
        if (address) {
            try {
                parsedAddress = typeof address === 'string' ? JSON.parse(address) : address
            } catch {
                return res.status(400).json({ success: false, message: 'Invalid address format' })
            }
        }

        await User.update(
            {
                name,
                phone: phone || '000000000',
                address: parsedAddress,
                dob: dob || 'Not Selected',
                gender: gender || 'Not Selected',
            },
            { where: { id: userId } }
        )

        if (imageFile) {
            const imageURL = await uploadImage(imageFile)
            await User.update({ image: imageURL }, { where: { id: userId } })
        }

        res.json({ success: true, message: 'Profile Updated' })

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const bookAppointment = async (req, res) => {
    const transaction = await sequelize.transaction()
    try {
        const userId = req.userId
        const { docId, slotDate, slotTime, payMode = 'later' } = req.body

        if (!docId || !slotDate || !slotTime) {
            await transaction.rollback()
            return res.status(400).json({ success: false, message: 'Missing booking details' })
        }

        if (!['now', 'later'].includes(payMode)) {
            await transaction.rollback()
            return res.status(400).json({ success: false, message: 'Invalid payMode. Use "now" or "later".' })
        }

        const docData = await lockDoctorForUpdate(docId, transaction)

        if (!docData || !docData.available) {
            await transaction.rollback()
            return res.status(400).json({ success: false, message: 'Doctor Not Available' })
        }

        let slots_booked = docData.slots_booked || {}

        if (slots_booked[slotDate]?.includes(slotTime)) {
            await transaction.rollback()
            return res.status(409).json({ success: false, message: 'Slot Not Available' })
        }

        if (slots_booked[slotDate]) {
            slots_booked[slotDate].push(slotTime)
        } else {
            slots_booked[slotDate] = [slotTime]
        }

        const userData = await User.findByPk(userId, {
            attributes: { exclude: ['password', 'resetToken', 'resetTokenExpiry'] },
            transaction
        })

        const paymentStatus = payMode === 'now' ? 'pending' : 'unpaid'

        const appointment = await Appointment.create({
            userId,
            docId,
            userData: userData.toJSON(),
            docData: docData.toJSON(),
            amount: docData.fees,
            slotTime,
            slotDate,
            date: Date.now(),
            payment: false,
            paymentStatus,
        }, { transaction })

        await Doctor.update({ slots_booked }, { where: { id: docId }, transaction })
        await transaction.commit()

        const user = await User.findByPk(userId)
        notifyAppointmentBooked(appointment, user?.email).catch(console.error)

        const response = {
            success: true,
            message: 'Appointment Booked',
            appointment: syncPaymentFields(appointment),
            payMode,
        }

        if (payMode === 'now') {
            try {
                const order = await createRazorpayOrder(appointment)
                response.order = order
            } catch (err) {
                response.paymentWarning = err.message
            }
        }

        res.json(response)

    } catch (error) {
        await transaction.rollback()
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const cancelAppointment = async (req, res) => {
    try {
        const userId = req.userId
        const { appointmentId } = req.body
        const appointmentData = await Appointment.findByPk(appointmentId)

        if (!appointmentData) {
            return res.status(404).json({ success: false, message: 'Appointment not found' })
        }

        if (appointmentData.userId !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized action' })
        }

        const status = appointmentData.paymentStatus || (appointmentData.payment ? 'paid' : 'unpaid')
        if (status === 'paid') {
            return res.status(400).json({ success: false, message: 'Paid appointments cannot be cancelled online. Contact support for refund.' })
        }

        if (appointmentData.cancelled) {
            return res.status(400).json({ success: false, message: 'Appointment already cancelled' })
        }

        await Appointment.update({ cancelled: true, paymentStatus: 'unpaid' }, { where: { id: appointmentId } })

        const { docId, slotDate, slotTime } = appointmentData
        const doctorData = await Doctor.findByPk(docId)

        if (doctorData) {
            let slots_booked = doctorData.slots_booked || {}
            if (slots_booked[slotDate]) {
                slots_booked[slotDate] = slots_booked[slotDate].filter(e => e !== slotTime)
            }
            await Doctor.update({ slots_booked }, { where: { id: docId } })
        }

        const user = await User.findByPk(userId)
        notifyAppointmentCancelled(appointmentData, user?.email).catch(console.error)

        res.json({ success: true, message: 'Appointment Cancelled' })

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const listAppointment = async (req, res) => {
    try {
        const userId = req.userId
        const appointments = await Appointment.findAll({ where: { userId } })

        res.json({
            success: true,
            appointments: appointments.map(syncPaymentFields),
        })

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const paymentRazorpay = async (req, res) => {
    try {
        const userId = req.userId
        const { appointmentId } = req.body
        const appointmentData = await Appointment.findByPk(appointmentId)

        if (!appointmentData || appointmentData.cancelled) {
            return res.status(404).json({ success: false, message: 'Appointment Cancelled or not found' })
        }

        if (appointmentData.userId !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized action' })
        }

        const status = appointmentData.paymentStatus || (appointmentData.payment ? 'paid' : 'unpaid')
        if (status === 'paid' || appointmentData.payment) {
            return res.status(400).json({ success: false, message: 'Appointment already paid' })
        }

        const order = await createRazorpayOrder(appointmentData)
        await Appointment.update({ paymentStatus: 'pending' }, { where: { id: appointmentId } })

        res.json({ success: true, order })

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const verifyRazorpay = async (req, res) => {
    try {
        const userId = req.userId
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Invalid payment response' })
        }

        const sign = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex')

        if (sign !== razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Invalid payment signature' })
        }

        const razorpayInstance = getRazorpayInstance()
        const orderInfo = await razorpayInstance.orders.fetch(razorpay_order_id)

        if (orderInfo.status !== 'paid') {
            return res.status(400).json({ success: false, message: 'Payment Failed' })
        }

        const appointment = await Appointment.findByPk(orderInfo.receipt)

        if (!appointment || appointment.cancelled) {
            return res.status(404).json({ success: false, message: 'Appointment not found or cancelled' })
        }

        if (appointment.userId !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized action' })
        }

        await Appointment.update(
            { payment: true, paymentStatus: 'paid' },
            { where: { id: orderInfo.receipt } }
        )
        res.json({ success: true, message: "Payment Successful" })
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const rescheduleAppointment = async (req, res) => {
    const transaction = await sequelize.transaction()
    try {
        const userId = req.userId
        const { appointmentId, newSlotDate, newSlotTime } = req.body

        if (!appointmentId || !newSlotDate || !newSlotTime) {
            await transaction.rollback()
            return res.status(400).json({ success: false, message: 'Missing reschedule details' })
        }

        const appointment = await Appointment.findByPk(appointmentId, { transaction })

        if (!appointment) {
            await transaction.rollback()
            return res.status(404).json({ success: false, message: 'Appointment not found' })
        }

        if (appointment.userId !== userId) {
            await transaction.rollback()
            return res.status(403).json({ success: false, message: 'Unauthorized action' })
        }

        if (appointment.cancelled || appointment.isCompleted) {
            await transaction.rollback()
            return res.status(400).json({ success: false, message: 'Cannot reschedule this appointment' })
        }

        const { docId, slotDate: oldSlotDate, slotTime: oldSlotTime } = appointment

        const doctorData = await lockDoctorForUpdate(docId, transaction)

        if (!doctorData || !doctorData.available) {
            await transaction.rollback()
            return res.status(400).json({ success: false, message: 'Doctor Not Available' })
        }

        let slots_booked = doctorData.slots_booked || {}

        if (slots_booked[newSlotDate]?.includes(newSlotTime)) {
            await transaction.rollback()
            return res.status(409).json({ success: false, message: 'New slot not available' })
        }

        if (slots_booked[oldSlotDate]) {
            slots_booked[oldSlotDate] = slots_booked[oldSlotDate].filter((e) => e !== oldSlotTime)
        }

        if (slots_booked[newSlotDate]) {
            slots_booked[newSlotDate].push(newSlotTime)
        } else {
            slots_booked[newSlotDate] = [newSlotTime]
        }

        await Appointment.update(
            { slotDate: newSlotDate, slotTime: newSlotTime },
            { where: { id: appointmentId }, transaction }
        )
        await Doctor.update({ slots_booked }, { where: { id: docId }, transaction })

        await transaction.commit()
        res.json({ success: true, message: 'Appointment Rescheduled' })
    } catch (error) {
        await transaction.rollback()
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body
        if (!email || !validator.isEmail(email)) {
            return res.status(400).json({ success: false, message: 'Valid email required' })
        }

        const user = await User.findOne({ where: { email } })
        if (!user) {
            return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' })
        }

        const resetToken = crypto.randomBytes(32).toString('hex')
        const resetTokenExpiry = Date.now() + 3600000

        await User.update({ resetToken, resetTokenExpiry }, { where: { id: user.id } })

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
        const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`
        notifyPasswordReset(email, resetUrl).catch(console.error)

        res.json({ success: true, message: 'If that email exists, a reset link has been sent.' })
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const resetPassword = async (req, res) => {
    try {
        const { email, token, password } = req.body
        if (!email || !token || !password) {
            return res.status(400).json({ success: false, message: 'Missing reset details' })
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' })
        }

        const user = await User.findOne({ where: { email, resetToken: token } })
        if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < Date.now()) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token' })
        }

        const salt = await bcrypt.genSalt(10)
        const hashedPassword = await bcrypt.hash(password, salt)

        await User.update(
            { password: hashedPassword, resetToken: null, resetTokenExpiry: null },
            { where: { id: user.id } }
        )

        res.json({ success: true, message: 'Password reset successful. You can login now.' })
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const contactUs = async (req, res) => {
    try {
        const { name, email, message } = req.body
        if (!name || !email || !message) {
            return res.status(400).json({ success: false, message: 'All fields are required' })
        }
        if (!validator.isEmail(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email' })
        }
        console.log(`[contact] ${name} <${email}>: ${message}`)
        res.json({ success: true, message: 'Message received. We will get back to you soon.' })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

export {
    registerUser, loginUser, getProfile, updateProfile, bookAppointment,
    listAppointment, cancelAppointment, paymentRazorpay, verifyRazorpay,
    rescheduleAppointment, forgotPassword, resetPassword, contactUs,
}

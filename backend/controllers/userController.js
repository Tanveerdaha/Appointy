import validator from 'validator'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import User from "../models/userModel.js";
import Appointment from "../models/appointmentModel.js";
import { uploadImage } from '../utils/uploadImage.js';
import { notifyAppointmentBooked, notifyAppointmentCancelled, notifyPasswordReset } from '../services/notificationService.js';
import { enqueueNotification } from '../services/notificationQueue.js'
import {
    reconcileCheckoutSession,
} from '../services/stripePaymentService.js'
import {
    createAppointmentPayment,
    getAppointmentPaymentStatus,
} from '../services/paymentService.js'
import {
    createAppointment,
    rescheduleAppointment as rescheduleAppointmentService,
    SchedulingError,
} from '../services/appointmentService.js'
import { PricingError } from '../services/pricingService.js'
import {
    LifecycleError,
    ACTOR_TYPE,
    APPOINTMENT_STATUS,
} from '../services/appointmentStateService.js'
import {
    requestCancellation,
    CancellationError,
    RefundError,
} from '../services/cancellationService.js'
import {
    issueAuthTokens,
    refreshAccessSession,
    logoutSession,
    revokeSessionsForUser,
    JWT_ROLES,
} from '../services/authSessionService.js'

const syncPaymentFields = (appointment) => {
    const status = appointment.paymentStatus || (appointment.payment ? 'paid' : 'unpaid')
    return { ...appointment.toJSON?.() ?? appointment, paymentStatus: status, payment: status === 'paid' }
}

const queueAppointmentBookedNotification = ({ appointment, userId }) => {
    try {
        enqueueNotification({
            type: 'appointment_booked',
            meta: { appointmentId: appointment.id },
            handler: async () => {
                const user = await User.findByPk(userId)
                return notifyAppointmentBooked(appointment, user?.email)
            },
        })
    } catch (error) {
        // Notification scheduling is post-commit and must never fail the booking response.
        console.error(JSON.stringify({
            scope: 'booking_notification',
            level: 'error',
            message: 'Failed to queue appointment notification',
            appointmentId: appointment.id,
            reason: error?.message || 'unknown',
            at: new Date().toISOString(),
        }))
    }
}

const queueAppointmentCancelledNotification = ({ appointment, userId }) => {
    try {
        enqueueNotification({
            type: 'appointment_cancelled',
            meta: { appointmentId: appointment.id },
            handler: async () => {
                const user = await User.findByPk(userId)
                return notifyAppointmentCancelled(appointment, user?.email)
            },
        })
    } catch (error) {
        // Cancellation is already committed; notification failures are post-commit only.
        console.error(JSON.stringify({
            scope: 'cancellation_notification',
            level: 'error',
            message: 'Failed to queue cancellation notification',
            appointmentId: appointment.id,
            reason: error?.message || 'unknown',
            at: new Date().toISOString(),
        }))
    }
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

        // Role is assigned server-side from registration context — never from the client body.
        const tokens = await issueAuthTokens(res, { id: user.id, role: JWT_ROLES.PATIENT })
        res.json({ success: true, ...tokens })

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
        const user = await User.unscoped().findOne({ where: { email } })

        if (!user) {
            return res.status(404).json({ success: false, message: "User does not exist" })
        }

        const isMatch = await bcrypt.compare(password, user.password)

        if (isMatch) {
            const tokens = await issueAuthTokens(res, { id: user.id, role: JWT_ROLES.PATIENT })
            res.json({ success: true, ...tokens })
        } else {
            res.status(401).json({ success: false, message: "Invalid credentials" })
        }
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const refreshUserToken = async (req, res) => {
    try {
        const result = await refreshAccessSession(req, res, JWT_ROLES.PATIENT)
        if (!result.ok) {
            return res.status(result.status).json({ success: false, message: result.message })
        }
        res.json(result.body)
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const logoutUser = async (req, res) => {
    try {
        const body = await logoutSession(req, res, JWT_ROLES.PATIENT)
        res.json(body)
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
    try {
        const userId = req.userId
        // Never accept client-supplied amount/fees — pricing is derived from doctor.fees.
        const { docId, startTime, slotDate, slotTime, payMode = 'later' } = req.body

        const appointment = await createAppointment({
            doctorId: docId,
            userId,
            startTime,
            slotDate,
            slotTime,
            payMode,
        })

        // AFTER COMMIT: user lookup and delivery run in the retryable notification job.
        queueAppointmentBookedNotification({ appointment, userId })

        const response = {
            success: true,
            message: 'Appointment Booked',
            appointment: syncPaymentFields(appointment),
            payMode,
        }

        if (payMode === 'now') {
            // AFTER COMMIT: Stripe checkout. Failure keeps the appointment and marks pending_retry.
            try {
                const result = await createAppointmentPayment({ appointmentId: appointment.id, userId })
                if (result.ok) {
                    await appointment.reload()
                    response.appointment = syncPaymentFields(appointment)
                    response.sessionUrl = result.sessionUrl
                    response.sessionId = result.sessionId
                    response.existingPayment = result.existingPayment
                } else {
                    await appointment.reload()
                    response.appointment = syncPaymentFields(appointment)
                    response.paymentWarning = result.message
                    response.paymentRetryable = result.retryable === true
                    response.paymentStatus = result.paymentStatus || appointment.paymentStatus
                }
            } catch (err) {
                await appointment.reload().catch(() => {})
                response.appointment = syncPaymentFields(appointment)
                response.paymentWarning = err.message
                response.paymentRetryable = true
            }
        }

        res.json(response)
    } catch (error) {
        if (error instanceof SchedulingError) {
            return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code })
        }
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const cancelAppointment = async (req, res) => {
    try {
        const userId = req.userId
        const { appointmentId, reason } = req.body

        const result = await requestCancellation({
            appointmentId,
            actorType: ACTOR_TYPE.USER,
            actorId: userId,
            reason: reason || 'Cancelled by patient',
        })

        queueAppointmentCancelledNotification({
            appointment: result.appointment,
            userId,
        })

        res.json({
            success: true,
            message: result.message,
            refundRequired: result.refundRequired || false,
            refundPending: result.refundPending || false,
            paymentStatus: result.appointment?.paymentStatus,
            appointmentStatus: result.appointment?.status,
        })
    } catch (error) {
        if (
            error instanceof CancellationError ||
            error instanceof RefundError ||
            error instanceof LifecycleError
        ) {
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

const PAYMENT_ERROR_STATUS = {
    appointment_not_found: 404,
    unauthorized: 403,
    already_paid: 400,
    stripe_unavailable: 502,
}

const paymentStripe = async (req, res) => {
    try {
        const userId = req.userId
        const { appointmentId } = req.body

        if (!appointmentId) {
            return res.status(400).json({ success: false, message: 'Missing appointmentId' })
        }

        const result = await createAppointmentPayment({ appointmentId, userId })

        if (!result.ok) {
            const statusCode = PAYMENT_ERROR_STATUS[result.code] || 400
            return res.status(statusCode).json({ success: false, message: result.message })
        }

        res.json({
            success: true,
            sessionUrl: result.sessionUrl,
            sessionId: result.sessionId,
            existingPayment: result.existingPayment,
        })

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const paymentStatus = async (req, res) => {
    try {
        const userId = req.userId
        const { appointmentId } = req.params

        const result = await getAppointmentPaymentStatus({ appointmentId, userId })

        if (!result.ok) {
            const statusCode = PAYMENT_ERROR_STATUS[result.code] || 400
            return res.status(statusCode).json({ success: false, message: result.message })
        }

        res.json({
            success: true,
            appointmentId: result.appointmentId,
            paymentStatus: result.paymentStatus,
            checkoutUrl: result.checkoutUrl,
            sessionId: result.sessionId,
        })

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

/**
 * Browser-return UX helper only.
 * Webhooks are the authoritative payment writer; this endpoint uses the same
 * reconciliation service so a late webhook and an early redirect stay consistent.
 */
const verifyStripe = async (req, res) => {
    try {
        const userId = req.userId
        const { sessionId } = req.body

        if (!sessionId) {
            return res.status(400).json({ success: false, message: 'Missing Stripe session id' })
        }

        const result = await reconcileCheckoutSession(sessionId, { expectedUserId: userId })

        if (result.status === 'paid' || result.status === 'already_paid') {
            return res.json({
                success: true,
                message: result.message || 'Payment Successful',
                paymentStatus: 'paid',
                status: result.status,
            })
        }

        if (result.status === 'cancelled_paid') {
            return res.status(409).json({
                success: false,
                message: 'Payment received but appointment is cancelled. Contact support for a refund.',
                status: result.status,
            })
        }

        if (result.code === 'auth_user_mismatch' || result.code === 'auth_appointment_mismatch') {
            return res.status(403).json({ success: false, message: 'Unauthorized action' })
        }

        if (result.code === 'appointment_not_found') {
            return res.status(404).json({ success: false, message: 'Appointment not found' })
        }

        if (result.code === 'not_paid') {
            return res.status(400).json({ success: false, message: 'Payment Failed' })
        }

        return res.status(400).json({
            success: false,
            message: result.message || 'Unable to confirm payment',
            status: result.status,
            code: result.code,
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const rescheduleAppointment = async (req, res) => {
    try {
        const userId = req.userId
        const { appointmentId, newStartTime, newSlotDate, newSlotTime } = req.body

        await rescheduleAppointmentService({
            appointmentId,
            userId,
            newStartTime,
            newSlotDate,
            newSlotTime,
        })

        res.json({ success: true, message: 'Appointment Rescheduled' })
    } catch (error) {
        if (error instanceof SchedulingError) {
            return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code })
        }
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

        const user = await User.unscoped().findOne({ where: { email } })
        if (!user) {
            return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' })
        }

        const resetToken = crypto.randomBytes(32).toString('hex')
        const resetTokenExpiry = Date.now() + 3600000

        await User.unscoped().update({ resetToken, resetTokenExpiry }, { where: { id: user.id } })

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

        const user = await User.unscoped().findOne({ where: { email, resetToken: token } })
        if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < Date.now()) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token' })
        }

        const salt = await bcrypt.genSalt(10)
        const hashedPassword = await bcrypt.hash(password, salt)

        await User.unscoped().update(
            { password: hashedPassword, resetToken: null, resetTokenExpiry: null },
            { where: { id: user.id } }
        )

        // Password change invalidates outstanding refresh sessions.
        await revokeSessionsForUser({ userId: user.id, role: JWT_ROLES.PATIENT })

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
    registerUser, loginUser, refreshUserToken, logoutUser, getProfile, updateProfile, bookAppointment,
    listAppointment, cancelAppointment, paymentStripe, paymentStatus, verifyStripe,
    rescheduleAppointment, forgotPassword, resetPassword, contactUs,
}

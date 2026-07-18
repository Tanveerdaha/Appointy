import { Op } from "sequelize";
import Appointment from "../models/appointmentModel.js";
import Doctor from "../models/doctorModel.js";
import bcrypt from "bcrypt";
import validator from "validator";
import { uploadImage } from "../utils/uploadImage.js";
import User from "../models/userModel.js"
import { verifyAdminPassword } from "../middlewares/authAdmin.js";
import { notifyAppointmentCancelled } from "../services/notificationService.js";
import { enqueueNotification } from "../services/notificationQueue.js";
import {
  completeAppointment as completeAppointmentLifecycle,
  LifecycleError,
  ACTOR_TYPE,
  APPOINTMENT_STATUS,
} from "../services/appointmentStateService.js";
import {
  requestCancellation,
  CancellationError,
  RefundError,
} from "../services/cancellationService.js";
import {
  retryOrReconcileFailedRefund,
} from "../services/refundService.js";
import {
  issueAuthTokens,
  refreshAccessSession,
  logoutSession,
  revokeSessionsForUser,
  JWT_ROLES,
} from "../services/authSessionService.js";
import {
  validateDoctorFee,
  updateDoctorFee,
  PricingError,
} from "../services/pricingService.js";
import { getNetCollectedMajor } from "../services/earningsService.js";
import { withTransaction } from "../utils/databaseTransaction.js";
import DoctorPriceHistory from "../models/doctorPriceHistoryModel.js";

const queueCancellationNotification = (appointment) => {
    try {
        enqueueNotification({
            type: 'appointment_cancelled',
            meta: { appointmentId: appointment.id },
            handler: () => notifyAppointmentCancelled(appointment, appointment.userData?.email),
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

// API for admin login — role is assigned server-side after credential check.
const loginAdmin = async (req, res) => {
    try {
        const { email, password } = req.body

        if (email === process.env.ADMIN_EMAIL && await verifyAdminPassword(password)) {
            const tokens = await issueAuthTokens(res, {
              id: email,
              role: JWT_ROLES.ADMIN,
              extra: { email },
            })
            res.json({ success: true, ...tokens })
        } else {
            res.status(401).json({ success: false, message: "Invalid credentials" })
        }

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const refreshAdminToken = async (req, res) => {
    try {
        const result = await refreshAccessSession(req, res, JWT_ROLES.ADMIN)
        if (!result.ok) {
            return res.status(result.status).json({ success: false, message: result.message })
        }
        res.json(result.body)
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

const logoutAdmin = async (req, res) => {
    try {
        const body = await logoutSession(req, res, JWT_ROLES.ADMIN)
        res.json(body)
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

    let normalizedFees;
    try {
      normalizedFees = validateDoctorFee(fees).fee;
    } catch (error) {
      if (error instanceof PricingError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      throw error;
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
      fees: normalizedFees,
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

// API for appointment cancellation (always reconciles paid appointments via refund)
const appointmentCancel = async (req, res) => {
    try {
        const { appointmentId, reason } = req.body

        const result = await requestCancellation({
            appointmentId,
            actorType: ACTOR_TYPE.ADMIN,
            actorId: null,
            reason,
        })

        queueCancellationNotification(result.appointment)

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

// Idempotent retry / reconcile for REFUND_FAILED payments (admin force).
const retryRefund = async (req, res) => {
    try {
        const { appointmentId } = req.body

        const result = await retryOrReconcileFailedRefund({
            appointmentId,
            actorType: ACTOR_TYPE.ADMIN,
            actorId: null,
            force: true,
        })

        const ledgerStatus = result.payment?.status
        res.json({
            success: true,
            message: result.message || 'Refund retry completed',
            outcome: result.outcome,
            refundResult: result.refund?.status || result.outcome,
            refundPending: ledgerStatus === 'REFUND_PENDING' || result.paymentStatus === 'refund_pending',
            paymentStatus: result.paymentStatus,
            appointmentStatus: result.appointmentStatus,
        })
    } catch (error) {
        if (error instanceof RefundError || error instanceof LifecycleError) {
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
        const [doctors, patients, appointments, collected, latestAppointments] = await Promise.all([
            Doctor.count(),
            User.count(),
            Appointment.count(),
            getNetCollectedMajor(),
            Appointment.findAll({
                order: [['createdAt', 'DESC']],
                limit: 5,
            }),
        ])

        const dashData = {
            doctors,
            appointments,
            patients,
            revenue: collected.netCollectedMajor,
            paidAppointments: collected.paidAppointmentCount,
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

        const adminActor = req.user?.email || req.user?.id || process.env.ADMIN_EMAIL || 'admin'

        await withTransaction(async (transaction) => {
            if (fees !== undefined && fees !== null && fees !== '') {
                await updateDoctorFee({
                    doctorId: docId,
                    targetDoctorId: docId,
                    newFee: fees,
                    changedBy: String(adminActor),
                    changedByRole: 'admin',
                    transaction,
                })
            }

            if (Object.keys(updateData).length > 0) {
                await Doctor.update(updateData, { where: { id: docId }, transaction })
            }
        }, { operation: 'admin_update_doctor' })

        res.json({ success: true, message: 'Doctor Updated' })
    } catch (error) {
        if (error instanceof PricingError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
                code: error.code,
            })
        }
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

// API to delete doctor — soft-delete when history exists; hard-delete only with zero dependents
const deleteDoctor = async (req, res) => {
    try {
        const { docId } = req.body

        if (!docId) {
            return res.status(400).json({ success: false, message: 'Doctor ID required' })
        }

        const doctor = await Doctor.findByPk(docId)
        if (!doctor) {
            return res.status(404).json({ success: false, message: 'Doctor not found' })
        }

        const activeAppointments = await Appointment.count({
            where: {
                docId,
                status: { [Op.in]: [APPOINTMENT_STATUS.PENDING_PAYMENT, APPOINTMENT_STATUS.CONFIRMED] },
            },
        })

        if (activeAppointments > 0) {
            return res.json({
                success: false,
                message: 'Doctor has active appointments. Cancel them first or mark unavailable.',
            })
        }

        const appointmentCount = await Appointment.count({ where: { docId } })
        const priceHistoryCount = await DoctorPriceHistory.count({ where: { doctorId: docId } })
        const hasHistory = appointmentCount > 0 || priceHistoryCount > 0

        await revokeSessionsForUser({ userId: docId, role: JWT_ROLES.DOCTOR })

        await withTransaction(async (transaction) => {
            if (hasHistory) {
                await doctor.update({ available: false }, { transaction })
                await doctor.destroy({ transaction })
            } else {
                await doctor.destroy({ force: true, transaction })
            }
        })

        res.json({ success: true, message: 'Doctor Removed' })
    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// Toggle a doctor's availability (target from validated body.docId)
const changeAvailability = async (req, res) => {
    try {
        const { docId } = req.body

        if (!docId) {
            return res.status(400).json({ success: false, message: 'Doctor ID missing' })
        }

        const doctor = await Doctor.findByPk(docId)
        if (!doctor) {
            return res.status(404).json({ success: false, message: 'Doctor not found' })
        }

        await Doctor.update(
            { available: !doctor.available },
            { where: { id: docId } }
        )

        res.json({ success: true, message: 'Availability changed successfully' })
    } catch (error) {
        console.error(error)
        res.status(500).json({ success: false, message: error.message })
    }
}

export {loginAdmin, refreshAdminToken, logoutAdmin, addDoctor, allDoctors, appointmentsAdmin, appointmentCancel, retryRefund, adminDashboard, appointmentComplete, updateDoctor, deleteDoctor, listUsers, changeAvailability}

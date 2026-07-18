import bcrypt from "bcrypt";
import { Op, fn, col } from "sequelize";
import Doctor from "../models/doctorModel.js";
import Appointment from "../models/appointmentModel.js";
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
  issueAuthTokens,
  refreshAccessSession,
  logoutSession,
  JWT_ROLES,
} from "../services/authSessionService.js";
import {
  updateDoctorFee,
  PricingError,
} from "../services/pricingService.js";
import sequelize from "../config/mysql.js";

// Doctor login — role is assigned server-side from the doctor table, never from the client.
const loginDoctor = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await Doctor.unscoped().findOne({ where: { email } });

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const tokens = await issueAuthTokens(res, { id: user.id, role: JWT_ROLES.DOCTOR });
    res.json({ success: true, ...tokens });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const refreshDoctorToken = async (req, res) => {
  try {
    const result = await refreshAccessSession(req, res, JWT_ROLES.DOCTOR);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }
    res.json(result.body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const logoutDoctor = async (req, res) => {
  try {
    const body = await logoutSession(req, res, JWT_ROLES.DOCTOR);
    res.json(body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get doctor's appointments
const appointmentsDoctor = async (req, res) => {
  try {
    const docId = req.user.id;
    const appointments = await Appointment.findAll({ where: { docId } });
    res.json({ success: true, appointments });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel appointment (paid bookings trigger full refund — doctor unavailable)
const appointmentCancel = async (req, res) => {
  try {
    const docId = req.user.id;
    const { appointmentId, reason } = req.body;

    const result = await requestCancellation({
      appointmentId,
      actorType: ACTOR_TYPE.DOCTOR,
      actorId: docId,
      reason: reason || 'DOCTOR_UNAVAILABLE',
    });

    res.json({
      success: true,
      message: result.message,
      refundRequired: result.refundRequired || false,
      refundPending: result.refundPending || false,
      paymentStatus: result.appointment?.paymentStatus,
      appointmentStatus: result.appointment?.status,
    });
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
      });
    }
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Complete appointment
const appointmentComplete = async (req, res) => {
  try {
    const docId = req.user.id;
    const { appointmentId } = req.body;

    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment || appointment.docId !== docId) {
      return res.status(403).json({ success: false, message: "Invalid doctor or appointment" });
    }

    await completeAppointmentLifecycle(appointment.id, {
      actorType: ACTOR_TYPE.DOCTOR,
      actorId: docId,
      reason: 'Completed by doctor',
    });
    res.json({ success: true, message: "Appointment Completed" });
  } catch (error) {
    if (error instanceof LifecycleError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all doctors (for frontend list)
const doctorList = async (req, res) => {
  try {
    const { search, speciality } = req.query
    const where = {}
    if (search) {
      where.name = { [Op.like]: `%${search}%` }
    }
    if (speciality) {
      where.speciality = { [Op.like]: `%${speciality}%` }
    }
    const doctors = await Doctor.findAll({
      where,
      attributes: { exclude: ['email'] }
    });
    res.json({ success: true, doctors });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Toggle doctor's availability
const changeAvailability = async (req, res) => {
  try {
    const docId = req.user?.id || req.body.docId;

    if (!docId) {
      return res.status(400).json({ success: false, message: "Doctor ID missing" });
    }

    if (req.user?.id && req.body.docId && req.body.docId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Unauthorized action" });
    }

    const doctor = await Doctor.findByPk(docId);

    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }

    await Doctor.update(
      { available: !doctor.available },
      { where: { id: docId } }
    );

    res.json({ success: true, message: "Availability changed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get doctor's profile
const doctorProfile = async (req, res) => {
  try {
    const docId = req.user.id;
    const profile = await Doctor.findByPk(docId, {
      attributes: { exclude: ['password'] }
    });
    res.json({ success: true, profileData: profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update doctor's profile (fee changes go through pricingService + audit)
const updateDoctorProfile = async (req, res) => {
  try {
    const docId = req.user.id;
    const { fees, address, available, about, docId: bodyDocId } = req.body;

    // Reject attempts to update another doctor's fee via spoofed id.
    if (bodyDocId != null && String(bodyDocId) !== String(docId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const updateData = {};
    if (address !== undefined) updateData.address = address;
    if (available !== undefined) updateData.available = available;
    if (about !== undefined) updateData.about = about;

    await sequelize.transaction(async (transaction) => {
      if (fees !== undefined) {
        await updateDoctorFee({
          doctorId: docId,
          targetDoctorId: bodyDocId ?? docId,
          newFee: fees,
          changedBy: docId,
          changedByRole: "doctor",
          transaction,
        });
      }

      if (Object.keys(updateData).length > 0) {
        await Doctor.update(updateData, { where: { id: docId }, transaction });
      }
    });

    res.json({ success: true, message: "Profile Updated" });
  } catch (error) {
    if (error instanceof PricingError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get dashboard data
const doctorDashboard = async (req, res) => {
  try {
    const docId = req.user.id;

    const [appointmentsCount, earningsRow, patientRows, latestAppointments] = await Promise.all([
      Appointment.count({ where: { docId } }),
      Appointment.findAll({
        where: {
          docId,
          status: { [Op.ne]: APPOINTMENT_STATUS.CANCELLED },
          [Op.or]: [
            { status: APPOINTMENT_STATUS.COMPLETED },
            { paymentStatus: 'paid' },
          ],
        },
        attributes: [[fn('SUM', col('amount')), 'total']],
        raw: true,
      }),
      Appointment.findAll({
        where: { docId },
        attributes: ['userId'],
        group: ['userId'],
        raw: true,
      }),
      Appointment.findAll({
        where: { docId },
        order: [['createdAt', 'DESC']],
        limit: 5,
      }),
    ]);

    const dashData = {
      earnings: Number(earningsRow?.[0]?.total) || 0,
      appointments: appointmentsCount,
      patients: patientRows.length,
      latestAppointments,
    };

    res.json({ success: true, dashData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export {
  loginDoctor,
  refreshDoctorToken,
  logoutDoctor,
  appointmentsDoctor,
  appointmentCancel,
  appointmentComplete,
  doctorList,
  changeAvailability,
  doctorProfile,
  updateDoctorProfile,
  doctorDashboard,
};


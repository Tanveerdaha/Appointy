import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { Op, fn, col } from "sequelize";
import Doctor from "../models/doctorModel.js";
import Appointment from "../models/appointmentModel.js";
import { cancelAppointmentAndReleaseSlot } from "../utils/appointmentSlots.js";

// Doctor login
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

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token });
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

// Cancel appointment
const appointmentCancel = async (req, res) => {
  try {
    const docId = req.user.id;
    const { appointmentId } = req.body;

    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment || appointment.docId !== docId) {
      return res.status(403).json({ success: false, message: "Invalid doctor or appointment" });
    }

    if (appointment.cancelled) {
      return res.status(400).json({ success: false, message: "Appointment already cancelled" });
    }

    await cancelAppointmentAndReleaseSlot(appointment);

    res.json({ success: true, message: "Appointment Cancelled" });
  } catch (error) {
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

    await Appointment.update(
      { isCompleted: true, status: 'COMPLETED' },
      { where: { id: appointmentId } }
    );
    res.json({ success: true, message: "Appointment Completed" });
  } catch (error) {
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

// Update doctor's profile
const updateDoctorProfile = async (req, res) => {
  try {
    const docId = req.user.id;
    const { fees, address, available, about } = req.body;

    await Doctor.update(
      { fees, address, available, about },
      { where: { id: docId } }
    );

    res.json({ success: true, message: "Profile Updated" });
  } catch (error) {
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
          [Op.or]: [{ isCompleted: true }, { payment: true }],
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
  appointmentsDoctor,
  appointmentCancel,
  appointmentComplete,
  doctorList,
  changeAvailability,
  doctorProfile,
  updateDoctorProfile,
  doctorDashboard,
};


/**
 * Earnings from StripePayment ledger: collected payments minus confirmed refunds.
 */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals'
import bcrypt from 'bcrypt'

let User, Doctor, Appointment, StripePayment
let PAYMENT_STATUS
let getNetCollectedMajor, fromStripeAmountMajor, netCollectedCentsForPayment

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test_jwt_secret'
  process.env.JWT_PATIENT_SECRET = 'test_patient_secret'
  process.env.JWT_DOCTOR_SECRET = 'test_doctor_secret'
  process.env.JWT_ADMIN_SECRET = 'test_admin_secret'
  process.env.ACCESS_TOKEN_EXPIRES = '15m'
  process.env.REFRESH_TOKEN_EXPIRES = '30d'
  process.env.JWT_ACCEPT_LEGACY = 'true'
  process.env.ADMIN_EMAIL = 'admin@test.com'
  process.env.ADMIN_PASSWORD = 'password123'
  process.env.DB_DIALECT = 'sqlite'
  process.env.SQLITE_STORAGE = ':memory:'
  process.env.CURRENCY = 'PKR'
  process.env.SCHEDULING_TIMEZONE = 'Asia/Karachi'
  process.env.STRIPE_SECRET_KEY = 'sk_test_earnings'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_earnings'

  const { initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  Appointment = (await import('../models/appointmentModel.js')).default
  const paymentModel = await import('../models/stripePaymentModel.js')
  StripePayment = paymentModel.default
  PAYMENT_STATUS = paymentModel.PAYMENT_STATUS
  const earnings = await import('../services/earningsService.js')
  getNetCollectedMajor = earnings.getNetCollectedMajor
  fromStripeAmountMajor = earnings.fromStripeAmountMajor
  netCollectedCentsForPayment = earnings.netCollectedCentsForPayment

  await initServices()
})

beforeEach(async () => {
  const RefundAudit = (await import('../models/refundAuditModel.js')).default
  const AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default
  await RefundAudit.destroy({ where: {}, truncate: true })
  await StripePayment.destroy({ where: {}, truncate: true })
  await AppointmentHistory.destroy({ where: {}, truncate: true })
  await Appointment.destroy({ where: {}, truncate: true })
  await Doctor.destroy({ where: {}, truncate: true })
  await User.destroy({ where: {}, truncate: true })
})

const seedUser = async () => {
  const hashed = await bcrypt.hash('password123', 10)
  return User.create({
    name: 'Patient',
    email: `patient_${Date.now()}_${Math.random()}@test.com`,
    password: hashed,
  })
}

const seedDoctor = async ({ fees = 2000 } = {}) => {
  const hashed = await bcrypt.hash('password123', 10)
  return Doctor.create({
    name: 'Dr Earnings',
    email: `doc_${Date.now()}_${Math.random()}@test.com`,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Earnings doctor',
    fees,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    available: true,
    slots_booked: {},
  })
}

const seedAppointment = async ({
  user,
  doctor,
  amount = 2000,
  status = 'CONFIRMED',
  paymentStatus = 'unpaid',
} = {}) => {
  const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000)
  return Appointment.create({
    userId: user.id,
    docId: doctor.id,
    userData: { id: user.id, name: user.name, email: user.email },
    docData: {
      id: doctor.id,
      name: doctor.name,
      fees: amount,
      address: doctor.address,
      image: doctor.image,
      speciality: doctor.speciality,
    },
    amount,
    slotTime: '10:00 AM',
    slotDate: '20_7_2026',
    startTime,
    heldStartTime: status === 'CANCELLED' ? null : startTime,
    status,
    statusChangedAt: new Date(),
    date: Date.now(),
    payment: paymentStatus === 'paid',
    paymentStatus,
    cancelled: status === 'CANCELLED',
    isCompleted: status === 'COMPLETED',
  })
}

const seedPayment = async ({
  appointment,
  user,
  amountMajor = 2000,
  status = PAYMENT_STATUS.PAID,
  refundAmount = null,
} = {}) => {
  return StripePayment.create({
    appointmentId: appointment.id,
    userId: user.id,
    stripeCheckoutSessionId: `cs_${appointment.id}_${Math.random().toString(36).slice(2, 8)}`,
    stripePaymentIntentId: `pi_${appointment.id}_${Math.random().toString(36).slice(2, 8)}`,
    amount: Math.round(amountMajor * 100),
    currency: 'pkr',
    status,
    paidAt: new Date(),
    activeAppointmentId: null,
    refundAmount,
    refundStatus: status === PAYMENT_STATUS.REFUNDED ? 'succeeded' : null,
    refundedAt: status === PAYMENT_STATUS.REFUNDED ? new Date() : null,
  })
}

describe('earningsService unit helpers', () => {
  test('fromStripeAmountMajor converts cents to major units', () => {
    expect(fromStripeAmountMajor(200000)).toBe(2000)
    expect(fromStripeAmountMajor(100050)).toBe(1000.5)
    expect(fromStripeAmountMajor(null)).toBe(0)
  })

  test('netCollectedCentsForPayment subtracts only confirmed refunds', () => {
    expect(
      netCollectedCentsForPayment({
        amount: 200000,
        status: PAYMENT_STATUS.PAID,
      })
    ).toBe(200000)
    expect(
      netCollectedCentsForPayment({
        amount: 200000,
        status: PAYMENT_STATUS.REFUND_PENDING,
        refundAmount: 200000,
      })
    ).toBe(200000)
    expect(
      netCollectedCentsForPayment({
        amount: 200000,
        status: PAYMENT_STATUS.REFUNDED,
        refundAmount: 200000,
      })
    ).toBe(0)
    expect(
      netCollectedCentsForPayment({
        amount: 200000,
        status: PAYMENT_STATUS.REFUNDED,
        refundAmount: 100000,
      })
    ).toBe(100000)
  })
})

describe('getNetCollectedMajor', () => {
  test('COMPLETED + unpaid does not count as earnings', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    await seedAppointment({
      user,
      doctor,
      status: 'COMPLETED',
      paymentStatus: 'unpaid',
    })

    const result = await getNetCollectedMajor({ docId: doctor.id })
    expect(result.netCollectedMajor).toBe(0)
    expect(result.paidAppointmentCount).toBe(0)
  })

  test('paid CONFIRMED appointment counts full amount', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor({ fees: 2000 })
    const appointment = await seedAppointment({
      user,
      doctor,
      amount: 2000,
      status: 'CONFIRMED',
      paymentStatus: 'paid',
    })
    await seedPayment({ appointment, user, amountMajor: 2000 })

    const result = await getNetCollectedMajor({ docId: doctor.id })
    expect(result.netCollectedMajor).toBe(2000)
    expect(result.paidAppointmentCount).toBe(1)
  })

  test('paid COMPLETED appointment counts full amount', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor({ fees: 1500 })
    const appointment = await seedAppointment({
      user,
      doctor,
      amount: 1500,
      status: 'COMPLETED',
      paymentStatus: 'paid',
    })
    await seedPayment({ appointment, user, amountMajor: 1500 })

    const result = await getNetCollectedMajor({ docId: doctor.id })
    expect(result.netCollectedMajor).toBe(1500)
    expect(result.paidAppointmentCount).toBe(1)
  })

  test('fully refunded payment nets to zero', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    const appointment = await seedAppointment({
      user,
      doctor,
      status: 'COMPLETED',
      paymentStatus: 'refunded',
    })
    await seedPayment({
      appointment,
      user,
      amountMajor: 2000,
      status: PAYMENT_STATUS.REFUNDED,
      refundAmount: 200000,
    })

    const result = await getNetCollectedMajor({ docId: doctor.id })
    expect(result.netCollectedMajor).toBe(0)
    expect(result.paidAppointmentCount).toBe(0)
  })

  test('partial refund retains net collected', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    const appointment = await seedAppointment({
      user,
      doctor,
      status: 'CANCELLED',
      paymentStatus: 'refunded',
    })
    await seedPayment({
      appointment,
      user,
      amountMajor: 2000,
      status: PAYMENT_STATUS.REFUNDED,
      refundAmount: 100000,
    })

    const result = await getNetCollectedMajor({ docId: doctor.id })
    expect(result.netCollectedMajor).toBe(1000)
    expect(result.paidAppointmentCount).toBe(1)
  })

  test('REFUND_PENDING still counts as collected', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    const appointment = await seedAppointment({
      user,
      doctor,
      paymentStatus: 'refund_pending',
    })
    await seedPayment({
      appointment,
      user,
      amountMajor: 2000,
      status: PAYMENT_STATUS.REFUND_PENDING,
      refundAmount: 200000,
    })

    const result = await getNetCollectedMajor({ docId: doctor.id })
    expect(result.netCollectedMajor).toBe(2000)
    expect(result.paidAppointmentCount).toBe(1)
  })

  test('doctor filter excludes other doctors payments', async () => {
    const user = await seedUser()
    const doctorA = await seedDoctor({ fees: 2000 })
    const doctorB = await seedDoctor({ fees: 3000 })
    const apptA = await seedAppointment({
      user,
      doctor: doctorA,
      amount: 2000,
      paymentStatus: 'paid',
    })
    const apptB = await seedAppointment({
      user,
      doctor: doctorB,
      amount: 3000,
      paymentStatus: 'paid',
    })
    await seedPayment({ appointment: apptA, user, amountMajor: 2000 })
    await seedPayment({ appointment: apptB, user, amountMajor: 3000 })

    const forA = await getNetCollectedMajor({ docId: doctorA.id })
    const forB = await getNetCollectedMajor({ docId: doctorB.id })
    expect(forA.netCollectedMajor).toBe(2000)
    expect(forB.netCollectedMajor).toBe(3000)
  })

  test('admin aggregate matches sum of per-doctor nets', async () => {
    const user = await seedUser()
    const doctorA = await seedDoctor({ fees: 2000 })
    const doctorB = await seedDoctor({ fees: 3000 })
    const apptA = await seedAppointment({
      user,
      doctor: doctorA,
      amount: 2000,
      paymentStatus: 'paid',
    })
    const apptB = await seedAppointment({
      user,
      doctor: doctorB,
      amount: 3000,
      paymentStatus: 'paid',
    })
    // Unpaid completed must not inflate admin or doctor totals
    await seedAppointment({
      user,
      doctor: doctorA,
      amount: 5000,
      status: 'COMPLETED',
      paymentStatus: 'unpaid',
    })
    await seedPayment({ appointment: apptA, user, amountMajor: 2000 })
    await seedPayment({ appointment: apptB, user, amountMajor: 3000 })

    const admin = await getNetCollectedMajor()
    const forA = await getNetCollectedMajor({ docId: doctorA.id })
    const forB = await getNetCollectedMajor({ docId: doctorB.id })

    expect(admin.netCollectedMajor).toBe(forA.netCollectedMajor + forB.netCollectedMajor)
    expect(admin.netCollectedMajor).toBe(5000)
    expect(admin.paidAppointmentCount).toBe(2)
  })
})

import nodemailer from 'nodemailer'

let transporter = null

const getTransporter = () => {
    if (transporter) return transporter
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
        return null
    }
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    })
    return transporter
}

export const sendEmail = async ({ to, subject, text, html }) => {
    const mailer = getTransporter()
    if (!mailer || !to) {
        console.log(`[notification] ${subject} -> ${to}: ${text}`)
        return { sent: false, reason: 'SMTP not configured' }
    }
    await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
        html,
    })
    return { sent: true }
}

export const notifyAppointmentBooked = async (appointment, userEmail) => {
    const { docData, slotDate, slotTime } = appointment
    return sendEmail({
        to: userEmail,
        subject: 'Appointment Booked - Appointy',
        text: `Your appointment with Dr. ${docData.name} on ${slotDate} at ${slotTime} has been booked.`,
        html: `<p>Your appointment with <strong>Dr. ${docData.name}</strong> on <strong>${slotDate}</strong> at <strong>${slotTime}</strong> has been booked.</p>`,
    })
}

export const notifyAppointmentCancelled = async (appointment, userEmail) => {
    const { docData, slotDate, slotTime } = appointment
    return sendEmail({
        to: userEmail,
        subject: 'Appointment Cancelled - Appointy',
        text: `Your appointment with Dr. ${docData.name} on ${slotDate} at ${slotTime} has been cancelled.`,
        html: `<p>Your appointment with <strong>Dr. ${docData.name}</strong> on <strong>${slotDate}</strong> at <strong>${slotTime}</strong> has been cancelled.</p>`,
    })
}

export const notifyPasswordReset = async (userEmail, resetUrl) => {
    return sendEmail({
        to: userEmail,
        subject: 'Reset Your Password - Appointy',
        text: `Reset your password: ${resetUrl}`,
        html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.</p>`,
    })
}

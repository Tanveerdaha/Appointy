/**
 * Request validation for booking / reschedule payloads.
 * Project has no Joi/Zod — lightweight validators matching existing style.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const hasStartTime = (body) =>
  Boolean(body.startTime || body.newStartTime)

const hasLegacySlot = (body) =>
  Boolean(
    (body.slotDate && body.slotTime) ||
    (body.newSlotDate && body.newSlotTime)
  )

export const validateBookAppointmentBody = (req, res, next) => {
  const { docId, payMode } = req.body || {}

  if (!docId || typeof docId !== 'string' || !UUID_RE.test(docId)) {
    return res.status(400).json({ success: false, message: 'Valid docId is required' })
  }

  if (!hasStartTime(req.body) && !hasLegacySlot(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'startTime is required (ISO-8601 with timezone offset)',
    })
  }

  if (req.body.startTime != null && typeof req.body.startTime !== 'string') {
    return res.status(400).json({ success: false, message: 'startTime must be a string' })
  }

  if (payMode != null && !['now', 'later'].includes(payMode)) {
    return res.status(400).json({ success: false, message: 'Invalid payMode. Use "now" or "later".' })
  }

  next()
}

export const validateRescheduleBody = (req, res, next) => {
  const { appointmentId } = req.body || {}

  if (!appointmentId || typeof appointmentId !== 'string' || !UUID_RE.test(appointmentId)) {
    return res.status(400).json({ success: false, message: 'Valid appointmentId is required' })
  }

  if (!hasStartTime(req.body) && !hasLegacySlot(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'newStartTime is required (ISO-8601 with timezone offset)',
    })
  }

  next()
}

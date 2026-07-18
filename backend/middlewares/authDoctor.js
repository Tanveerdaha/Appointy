import Doctor from '../models/doctorModel.js'
import { extractToken } from '../utils/extractToken.js'
import {
  JWT_ROLES,
  verifyDoctorToken,
  verifyLegacyToken,
  acceptLegacyTokens,
  logJwtFailure,
} from '../services/jwtService.js'

const authDoctor = async (req, res, next) => {
  try {
    const token = extractToken(req, ['dtoken', 'authorization'])
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authorization token missing' })
    }

    const endpoint = req.originalUrl || req.url
    let decoded
    try {
      decoded = verifyDoctorToken(token, { endpoint })
    } catch (primaryError) {
      if (!acceptLegacyTokens()) throw primaryError
      decoded = verifyLegacyToken(token, JWT_ROLES.DOCTOR, { endpoint })
    }

    const doctor = await Doctor.findByPk(decoded.sub)
    if (!doctor) {
      logJwtFailure({
        reason: 'unknown_subject',
        role: JWT_ROLES.DOCTOR,
        endpoint,
      })
      return res.status(401).json({ success: false, message: 'Invalid or expired token' })
    }

    req.auth = {
      id: doctor.id,
      role: JWT_ROLES.DOCTOR,
      tokenType: decoded.tokenType,
      legacy: Boolean(decoded.legacy),
    }
    req.user = { id: doctor.id, role: JWT_ROLES.DOCTOR }
    next()
  } catch (error) {
    console.error('Auth Error:', error.message)
    res.status(401).json({ success: false, message: 'Invalid or expired token' })
  }
}

export default authDoctor

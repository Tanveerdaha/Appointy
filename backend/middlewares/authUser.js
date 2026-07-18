import User from '../models/userModel.js'
import { extractToken } from '../utils/extractToken.js'
import {
  JWT_ROLES,
  verifyPatientToken,
  verifyLegacyToken,
  acceptLegacyTokens,
  logJwtFailure,
} from '../services/jwtService.js'

const authUser = async (req, res, next) => {
  const token = extractToken(req, ['token'])
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not Authorized Login Again' })
  }

  const endpoint = req.originalUrl || req.url

  try {
    let decoded
    try {
      decoded = verifyPatientToken(token, { endpoint })
    } catch (primaryError) {
      if (!acceptLegacyTokens()) throw primaryError
      decoded = verifyLegacyToken(token, JWT_ROLES.PATIENT, { endpoint })
    }

    const user = await User.findByPk(decoded.sub)
    if (!user) {
      logJwtFailure({
        reason: 'unknown_subject',
        role: JWT_ROLES.PATIENT,
        endpoint,
      })
      return res.status(401).json({ success: false, message: 'Invalid or expired token' })
    }

    req.auth = {
      id: user.id,
      role: JWT_ROLES.PATIENT,
      tokenType: decoded.tokenType,
      legacy: Boolean(decoded.legacy),
    }
    req.userId = user.id
    if (!req.body) req.body = {}
    req.body.userId = user.id
    next()
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' })
  }
}

export default authUser

import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { extractToken } from '../utils/extractToken.js'
import {
  JWT_ROLES,
  verifyAdminToken,
  verifyLegacyToken,
  acceptLegacyTokens,
  logJwtFailure,
} from '../services/jwtService.js'

let adminPasswordHash = null

export const initAdminAuth = async () => {
  const plain = process.env.ADMIN_PASSWORD || ''
  if (plain.startsWith('$2')) {
    adminPasswordHash = plain
  } else if (plain) {
    adminPasswordHash = await bcrypt.hash(plain, 10)
  }
}

const verifyAdminPassword = async (password) => {
  if (!adminPasswordHash) return false
  if (adminPasswordHash.startsWith('$2')) {
    return bcrypt.compare(password, adminPasswordHash)
  }
  return password === process.env.ADMIN_PASSWORD
}

const authAdmin = async (req, res, next) => {
  try {
    const token = extractToken(req, ['atoken'])
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not Authorized Login Again' })
    }

    const endpoint = req.originalUrl || req.url
    let decoded
    try {
      decoded = verifyAdminToken(token, { endpoint })
    } catch (primaryError) {
      if (!acceptLegacyTokens()) throw primaryError
      decoded = verifyLegacyToken(token, JWT_ROLES.ADMIN, { endpoint })
    }

    const email = decoded.email || decoded.sub
    if (decoded.role !== JWT_ROLES.ADMIN || email !== process.env.ADMIN_EMAIL) {
      logJwtFailure({
        reason: 'wrong_role',
        role: JWT_ROLES.ADMIN,
        endpoint,
      })
      return res.status(401).json({ success: false, message: 'Not Authorized Login Again' })
    }

    req.auth = {
      id: email,
      email,
      role: JWT_ROLES.ADMIN,
      tokenType: decoded.tokenType,
      legacy: Boolean(decoded.legacy),
    }
    req.user = { id: email, email, role: JWT_ROLES.ADMIN }
    next()
  } catch (error) {
    if (!(error instanceof jwt.JsonWebTokenError) && error.name !== 'TokenExpiredError') {
      console.log(error)
    }
    res.status(401).json({ success: false, message: 'Not Authorized Login Again' })
  }
}

export { verifyAdminPassword }
export default authAdmin

import crypto from 'crypto'
import jwt from 'jsonwebtoken'

export const JWT_ISSUER = 'appointy-auth'

export const JWT_ROLES = Object.freeze({
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  ADMIN: 'admin',
})

export const JWT_AUDIENCES = Object.freeze({
  [JWT_ROLES.PATIENT]: 'appointy-patient-api',
  [JWT_ROLES.DOCTOR]: 'appointy-doctor-api',
  [JWT_ROLES.ADMIN]: 'appointy-admin-api',
})

export const TOKEN_TYPE = Object.freeze({
  ACCESS: 'access',
  REFRESH: 'refresh',
})

const ROLE_SECRET_ENV = Object.freeze({
  [JWT_ROLES.PATIENT]: 'JWT_PATIENT_SECRET',
  [JWT_ROLES.DOCTOR]: 'JWT_DOCTOR_SECRET',
  [JWT_ROLES.ADMIN]: 'JWT_ADMIN_SECRET',
})

const REFRESH_COOKIE = Object.freeze({
  [JWT_ROLES.PATIENT]: 'appointy_patient_refresh',
  [JWT_ROLES.DOCTOR]: 'appointy_doctor_refresh',
  [JWT_ROLES.ADMIN]: 'appointy_admin_refresh',
})

/**
 * Resolve a role-specific signing secret.
 * Prefer JWT_*_SECRET. If only JWT_SECRET exists (legacy .env), derive a
 * distinct key per role so tokens are not interchangeable.
 */
export const getSecretForRole = (role) => {
  const envKey = ROLE_SECRET_ENV[role]
  if (!envKey) {
    throw new Error(`Unsupported JWT role: ${role}`)
  }
  if (process.env[envKey]) {
    return process.env[envKey]
  }
  if (process.env.JWT_SECRET) {
    return crypto
      .createHmac('sha256', process.env.JWT_SECRET)
      .update(`appointy:${role}`)
      .digest('hex')
  }
  throw new Error(`Missing ${envKey} (or JWT_SECRET fallback)`)
}

export const getAccessTokenExpiresIn = () =>
  process.env.ACCESS_TOKEN_EXPIRES || '15m'

export const getRefreshTokenExpiresMs = () => {
  const raw = process.env.REFRESH_TOKEN_EXPIRES || '30d'
  const match = /^(\d+)([smhd])$/i.exec(String(raw).trim())
  if (!match) return 30 * 24 * 60 * 60 * 1000
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return amount * multipliers[unit]
}

export const acceptLegacyTokens = () => {
  if (process.env.JWT_ACCEPT_LEGACY != null) {
    return process.env.JWT_ACCEPT_LEGACY === 'true'
  }
  // Grace period default: allow legacy only outside production
  return process.env.NODE_ENV !== 'production'
}

export const getRefreshCookieName = (role) => REFRESH_COOKIE[role]

export const getRefreshCookieOptions = (role) => {
  const pathByRole = {
    [JWT_ROLES.PATIENT]: '/api/user',
    [JWT_ROLES.DOCTOR]: '/api/doctor',
    [JWT_ROLES.ADMIN]: '/api/admin',
  }
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: getRefreshTokenExpiresMs(),
    path: pathByRole[role] || '/',
  }
}

/**
 * Log JWT validation failures without secrets or token values.
 */
export const logJwtFailure = ({ reason, role, endpoint, detail }) => {
  const entry = {
    event: 'jwt_validation_failed',
    reason,
    role: role || null,
    endpoint: endpoint || null,
    detail: detail || null,
    timestamp: new Date().toISOString(),
  }
  console.warn('[security]', JSON.stringify(entry))
}

const mapVerifyError = (error) => {
  if (!error) return 'invalid_token'
  if (error.name === 'TokenExpiredError') return 'expired'
  if (error.name === 'JsonWebTokenError') {
    const msg = String(error.message || '').toLowerCase()
    if (msg.includes('audience')) return 'wrong_audience'
    if (msg.includes('issuer')) return 'wrong_issuer'
    if (msg.includes('signature')) return 'invalid_signature'
    return 'invalid_token'
  }
  return 'invalid_token'
}

/**
 * Server-controlled access token generation.
 * Role must come from authenticated DB/context — never from the client.
 */
export const generateAccessToken = ({ id, role, extra = {} }) => {
  if (!id) throw new Error('Access token requires id')
  if (!JWT_AUDIENCES[role]) throw new Error(`Unsupported role for access token: ${role}`)

  const secret = getSecretForRole(role)
  const payload = {
    role,
    tokenType: TOKEN_TYPE.ACCESS,
    ...extra,
  }

  return jwt.sign(payload, secret, {
    subject: String(id),
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCES[role],
    expiresIn: getAccessTokenExpiresIn(),
  })
}

const assertAccessClaims = (decoded, expectedRole) => {
  if (decoded.tokenType !== TOKEN_TYPE.ACCESS) {
    const err = new Error('Invalid token type')
    err.code = 'wrong_token_type'
    throw err
  }
  if (decoded.role !== expectedRole) {
    const err = new Error('Invalid token role')
    err.code = 'wrong_role'
    throw err
  }
  const sub = decoded.sub || decoded.id
  if (!sub) {
    const err = new Error('Missing subject')
    err.code = 'missing_subject'
    throw err
  }
  return { ...decoded, sub: String(sub), id: String(sub) }
}

const verifyWithRole = (token, role, { endpoint } = {}) => {
  try {
    const decoded = jwt.verify(token, getSecretForRole(role), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCES[role],
    })
    return assertAccessClaims(decoded, role)
  } catch (error) {
    const reason = error.code || mapVerifyError(error)
    logJwtFailure({ reason, role, endpoint, detail: error.message })
    throw error
  }
}

export const verifyPatientToken = (token, opts) =>
  verifyWithRole(token, JWT_ROLES.PATIENT, opts)

export const verifyDoctorToken = (token, opts) =>
  verifyWithRole(token, JWT_ROLES.DOCTOR, opts)

export const verifyAdminToken = (token, opts) =>
  verifyWithRole(token, JWT_ROLES.ADMIN, opts)

/**
 * Legacy tokens: { id } for patient/doctor, { role, email } for admin.
 * Only used when JWT_ACCEPT_LEGACY is enabled. Entity existence is checked
 * by middleware so a doctor UUID cannot act as a patient.
 */
export const verifyLegacyToken = (token, expectedRole, { endpoint } = {}) => {
  if (!acceptLegacyTokens() || !process.env.JWT_SECRET) {
    const err = new Error('Legacy tokens disabled')
    err.code = 'legacy_disabled'
    throw err
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    if (expectedRole === JWT_ROLES.ADMIN) {
      if (decoded.role !== 'admin' || decoded.email !== process.env.ADMIN_EMAIL) {
        const err = new Error('Invalid legacy admin token')
        err.code = 'wrong_role'
        throw err
      }
      return {
        ...decoded,
        sub: String(decoded.email),
        id: String(decoded.email),
        role: JWT_ROLES.ADMIN,
        tokenType: TOKEN_TYPE.ACCESS,
        legacy: true,
      }
    }

    // Reject legacy tokens that already claim a different role
    if (decoded.role && decoded.role !== expectedRole) {
      const err = new Error('Legacy token role mismatch')
      err.code = 'wrong_role'
      throw err
    }

    const id = decoded.id || decoded.sub
    if (!id) {
      const err = new Error('Legacy token missing id')
      err.code = 'missing_subject'
      throw err
    }

    return {
      ...decoded,
      sub: String(id),
      id: String(id),
      role: expectedRole,
      tokenType: TOKEN_TYPE.ACCESS,
      legacy: true,
    }
  } catch (error) {
    const reason = error.code || mapVerifyError(error)
    logJwtFailure({ reason: `legacy_${reason}`, role: expectedRole, endpoint, detail: error.message })
    throw error
  }
}

export const hashToken = (rawToken) =>
  crypto.createHash('sha256').update(rawToken).digest('hex')

export const generateOpaqueToken = () =>
  crypto.randomBytes(48).toString('base64url')

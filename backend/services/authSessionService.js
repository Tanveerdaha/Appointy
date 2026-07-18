import {
  getRefreshCookieName,
  getRefreshCookieOptions,
  JWT_ROLES,
} from '../services/jwtService.js'
import {
  createRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/refreshTokenService.js'
import { generateAccessToken } from '../services/jwtService.js'

/**
 * Issue access + refresh tokens. Role is always server-controlled.
 * Access token is returned in the response body (clients may keep it in memory).
 * Refresh token is set as an HttpOnly Secure cookie.
 *
 * XSS note: if clients store the access token in localStorage, any XSS can
 * steal it until expiry. Prefer in-memory access tokens + HttpOnly refresh.
 */
export const issueAuthTokens = async (res, { id, role, extra = {} }) => {
  const accessToken = generateAccessToken({ id, role, extra })
  const { rawToken: refreshToken } = await createRefreshToken({ userId: id, role })

  res.cookie(
    getRefreshCookieName(role),
    refreshToken,
    getRefreshCookieOptions(role)
  )

  return {
    token: accessToken,
    accessToken,
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES || '15m',
    tokenType: 'Bearer',
  }
}

export const clearRefreshCookie = (res, role) => {
  const options = getRefreshCookieOptions(role)
  res.clearCookie(getRefreshCookieName(role), {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  })
}

export const readRefreshCookie = (req, role) => {
  const name = getRefreshCookieName(role)
  return req.cookies?.[name] || null
}

export const refreshAccessSession = async (req, res, role) => {
  const raw = readRefreshCookie(req, role)
  if (!raw) {
    return { ok: false, status: 401, message: 'Refresh token missing' }
  }

  const rotated = await rotateRefreshToken(raw)
  if (!rotated || rotated.record.role !== role) {
    clearRefreshCookie(res, role)
    return { ok: false, status: 401, message: 'Invalid or expired refresh token' }
  }

  const accessToken = generateAccessToken({
    id: rotated.record.userId,
    role,
    extra: role === JWT_ROLES.ADMIN
      ? { email: process.env.ADMIN_EMAIL }
      : {},
  })

  res.cookie(
    getRefreshCookieName(role),
    rotated.rawToken,
    getRefreshCookieOptions(role)
  )

  return {
    ok: true,
    body: {
      success: true,
      token: accessToken,
      accessToken,
      expiresIn: process.env.ACCESS_TOKEN_EXPIRES || '15m',
      tokenType: 'Bearer',
    },
  }
}

export const logoutSession = async (req, res, role) => {
  const raw = readRefreshCookie(req, role)
  if (raw) {
    await revokeRefreshToken(raw)
  }
  clearRefreshCookie(res, role)
  return { success: true, message: 'Logged out' }
}

export const revokeSessionsForUser = async ({ userId, role }) =>
  revokeAllRefreshTokens({ userId, role })

export { JWT_ROLES }

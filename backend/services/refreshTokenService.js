import { Op } from 'sequelize'
import RefreshToken from '../models/refreshTokenModel.js'
import {
  generateOpaqueToken,
  getRefreshTokenExpiresMs,
  hashToken,
} from './jwtService.js'

export const createRefreshToken = async ({ userId, role }) => {
  const rawToken = generateOpaqueToken()
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + getRefreshTokenExpiresMs())

  const record = await RefreshToken.create({
    userId: String(userId),
    role,
    tokenHash,
    expiresAt,
  })

  return { rawToken, record }
}

export const findValidRefreshToken = async (rawToken) => {
  if (!rawToken) return null
  const tokenHash = hashToken(rawToken)
  const record = await RefreshToken.findOne({ where: { tokenHash } })
  if (!record) return null
  if (record.revokedAt) return null
  if (new Date(record.expiresAt).getTime() <= Date.now()) return null
  return record
}

export const revokeRefreshToken = async (rawToken) => {
  const record = await findValidRefreshToken(rawToken)
  if (!record) {
    // Still mark hashed token if present but expired
    const tokenHash = hashToken(rawToken)
    const existing = await RefreshToken.findOne({ where: { tokenHash } })
    if (existing && !existing.revokedAt) {
      existing.revokedAt = new Date()
      await existing.save()
    }
    return existing || null
  }
  record.revokedAt = new Date()
  await record.save()
  return record
}

export const revokeAllRefreshTokens = async ({ userId, role }) => {
  const where = {
    userId: String(userId),
    revokedAt: null,
  }
  if (role) where.role = role

  const [count] = await RefreshToken.update(
    { revokedAt: new Date() },
    { where }
  )
  return count
}

/**
 * Rotate: revoke current refresh token and issue a new one (same user/role).
 */
export const rotateRefreshToken = async (rawToken) => {
  const current = await findValidRefreshToken(rawToken)
  if (!current) return null

  current.revokedAt = new Date()
  await current.save()

  return createRefreshToken({
    userId: current.userId,
    role: current.role,
  })
}

export const purgeExpiredRefreshTokens = async () => {
  return RefreshToken.destroy({
    where: {
      [Op.or]: [
        { expiresAt: { [Op.lt]: new Date() } },
        { revokedAt: { [Op.ne]: null } },
      ],
    },
  })
}

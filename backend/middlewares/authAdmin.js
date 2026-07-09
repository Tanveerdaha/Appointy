import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { extractToken } from '../utils/extractToken.js'

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
        const token_decode = jwt.verify(token, process.env.JWT_SECRET)
        if (token_decode.role !== 'admin' || token_decode.email !== process.env.ADMIN_EMAIL) {
            return res.status(401).json({ success: false, message: 'Not Authorized Login Again' })
        }
        next()
    } catch (error) {
        console.log(error)
        res.status(401).json({ success: false, message: 'Not Authorized Login Again' })
    }
}

export { verifyAdminPassword }
export default authAdmin

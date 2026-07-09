import jwt from 'jsonwebtoken'
import { extractToken } from '../utils/extractToken.js'

const authDoctor = async (req, res, next) => {
    try {
        const token = extractToken(req, ['dtoken', 'authorization'])
        if (!token) {
            return res.status(401).json({ success: false, message: 'Authorization token missing' })
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        req.user = { id: decoded.id }
        next()
    } catch (error) {
        console.error('Auth Error:', error.message)
        res.status(401).json({ success: false, message: 'Invalid or expired token' })
    }
}

export default authDoctor

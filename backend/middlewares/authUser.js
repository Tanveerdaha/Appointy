import jwt from 'jsonwebtoken'
import { extractToken } from '../utils/extractToken.js'

const authUser = async (req, res, next) => {
    const token = extractToken(req, ['token'])
    if (!token) {
        return res.status(401).json({ success: false, message: 'Not Authorized Login Again' })
    }
    try {
        const token_decode = jwt.verify(token, process.env.JWT_SECRET)
        req.userId = token_decode.id
        if (!req.body) req.body = {}
        req.body.userId = token_decode.id
        next()
    } catch (error) {
        console.log(error)
        res.status(401).json({ success: false, message: 'Invalid or expired token' })
    }
}

export default authUser

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { connectDB } from './config/mysql.js'
import connectCloudinary from './config/cloudinary.js'
import { initAdminAuth } from './middlewares/authAdmin.js'
import './models/index.js'
import adminRouter from './routes/adminRoute.js'
import doctorRouter from './routes/doctorRoute.js'
import userRouter from './routes/userRoute.js'
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js'
import sequelize from './config/mysql.js'

export const createApp = () => {
    const app = express()

    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5174')
        .split(',')
        .map((o) => o.trim())

    app.use(helmet())
    app.use(express.json({ limit: '10mb' }))
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true)
            } else {
                callback(new Error('Not allowed by CORS'))
            }
        },
        credentials: true,
    }))

    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 50,
        message: { success: false, message: 'Too many requests, please try again later.' },
    })

    const bookingLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        message: { success: false, message: 'Too many booking requests, please try again later.' },
    })

    app.use('/api/user/login', authLimiter)
    app.use('/api/user/register', authLimiter)
    app.use('/api/admin/login', authLimiter)
    app.use('/api/doctor/login', authLimiter)
    app.use('/api/user/book-appointment', bookingLimiter)
    app.use('/api/user/reschedule-appointment', bookingLimiter)

    app.get('/', (req, res) => {
        res.send('API Working')
    })

    app.get('/api/health', async (req, res) => {
        try {
            await sequelize.authenticate()
            res.json({ success: true, status: 'healthy', database: 'connected' })
        } catch (error) {
            res.status(503).json({ success: false, status: 'unhealthy', database: 'disconnected' })
        }
    })

    app.use('/api/admin', adminRouter)
    app.use('/api/doctor', doctorRouter)
    app.use('/api/user', userRouter)

    app.use(notFoundHandler)
    app.use(errorHandler)

    return app
}

export const initServices = async () => {
    await connectDB()
    connectCloudinary()
    await initAdminAuth()
}

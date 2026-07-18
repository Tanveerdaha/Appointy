import express from 'express'
import { getSchedulingConfigHandler } from '../controllers/schedulingController.js'

const schedulingRouter = express.Router()

schedulingRouter.get('/config', getSchedulingConfigHandler)

export default schedulingRouter

import { getSchedulingConfig } from '../utils/slotTime.js'

export const getSchedulingConfigHandler = (req, res) => {
  res.json({
    success: true,
    ...getSchedulingConfig(),
  })
}

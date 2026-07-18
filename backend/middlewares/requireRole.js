/**
 * Authorization middleware — use after authentication middleware.
 * Authentication answers "who are you?"; this answers "are you allowed?"
 */
const requireRole = (...allowedRoles) => (req, res, next) => {
  const role = req.auth?.role || req.user?.role
  if (!role || !allowedRoles.includes(role)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden',
    })
  }
  next()
}

export default requireRole

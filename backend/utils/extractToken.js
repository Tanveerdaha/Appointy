/**
 * Extract JWT from Authorization Bearer header or legacy custom headers.
 */
export const extractToken = (req, legacyHeaders = []) => {
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.split(' ')[1]
    }
    for (const header of legacyHeaders) {
        if (req.headers[header]) {
            const value = req.headers[header]
            return value.startsWith('Bearer ') ? value.split(' ')[1] : value
        }
    }
    return null
}

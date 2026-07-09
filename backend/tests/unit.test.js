import { extractToken } from '../utils/extractToken.js'

describe('extractToken', () => {
    test('extracts Bearer token from Authorization header', () => {
        const req = { headers: { authorization: 'Bearer abc123' } }
        expect(extractToken(req)).toBe('abc123')
    })

    test('extracts legacy token header', () => {
        const req = { headers: { token: 'legacy-token' } }
        expect(extractToken(req, ['token'])).toBe('legacy-token')
    })

    test('extracts atoken header', () => {
        const req = { headers: { atoken: 'admin-token' } }
        expect(extractToken(req, ['atoken'])).toBe('admin-token')
    })

    test('returns null when no token present', () => {
        expect(extractToken({ headers: {} })).toBeNull()
    })
})

describe('authAdmin verifyAdminPassword', () => {
    test('verifies plaintext admin password', async () => {
        process.env.ADMIN_PASSWORD = 'password123'
        const { verifyAdminPassword, initAdminAuth } = await import('../middlewares/authAdmin.js')
        await initAdminAuth()
        expect(await verifyAdminPassword('password123')).toBe(true)
        expect(await verifyAdminPassword('wrong')).toBe(false)
    })
})

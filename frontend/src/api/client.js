import axios from 'axios'

/** Empty in dev uses Vite proxy (/api → localhost:4000). Set VITE_BACKEND_URL for production. */
export const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || ''

const AUTH_PATHS = ['/api/user/login', '/api/user/register', '/api/user/refresh']

/**
 * Access tokens are currently kept in localStorage for compatibility.
 * XSS can steal them until expiry — prefer in-memory storage when possible.
 * Refresh tokens use HttpOnly Secure cookies (not readable by JS).
 */
const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.token = token
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let refreshPromise = null

const refreshAccessToken = async () => {
  if (!refreshPromise) {
    refreshPromise = api
      .post('/api/user/refresh')
      .then((res) => {
        const next = res.data?.accessToken || res.data?.token
        if (!next) throw new Error('No access token in refresh response')
        localStorage.setItem('token', next)
        return next
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const url = original?.url || ''
    const isAuthAttempt = AUTH_PATHS.some((path) => url.includes(path))

    if (error.response?.status === 401 && !isAuthAttempt && original && !original._retry) {
      original._retry = true
      try {
        const nextToken = await refreshAccessToken()
        original.headers = original.headers || {}
        original.headers.token = nextToken
        original.headers.Authorization = `Bearer ${nextToken}`
        return api(original)
      } catch {
        localStorage.removeItem('token')
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  }
)

export default api

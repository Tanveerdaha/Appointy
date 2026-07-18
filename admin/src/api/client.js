import axios from 'axios'

/** Empty in dev uses Vite proxy (/api → localhost:4000). Set VITE_BACKEND_URL for production. */
export const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || ''

/**
 * Access tokens remain in localStorage (XSS risk until expiry).
 * Refresh tokens are HttpOnly Secure cookies — not readable by JavaScript.
 */
const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const at = localStorage.getItem('aToken')
  const dt = localStorage.getItem('dToken')
  if (at) {
    config.headers.atoken = at
    config.headers.Authorization = `Bearer ${at}`
  } else if (dt) {
    config.headers.dtoken = dt
    config.headers.Authorization = `Bearer ${dt}`
  }
  return config
})

let refreshPromise = null

const refreshAccessToken = async () => {
  if (!refreshPromise) {
    const isAdmin = Boolean(localStorage.getItem('aToken'))
    const path = isAdmin ? '/api/admin/refresh' : '/api/doctor/refresh'
    refreshPromise = api
      .post(path)
      .then((res) => {
        const next = res.data?.accessToken || res.data?.token
        if (!next) throw new Error('No access token in refresh response')
        if (isAdmin) localStorage.setItem('aToken', next)
        else localStorage.setItem('dToken', next)
        return { next, isAdmin }
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
    const isAuthRequest =
      url.includes('/login') || url.includes('/refresh') || url.includes('/logout')

    if (error.response?.status === 401 && !isAuthRequest && original && !original._retry) {
      original._retry = true
      try {
        const { next, isAdmin } = await refreshAccessToken()
        original.headers = original.headers || {}
        if (isAdmin) {
          original.headers.atoken = next
        } else {
          original.headers.dtoken = next
        }
        original.headers.Authorization = `Bearer ${next}`
        return api(original)
      } catch {
        localStorage.removeItem('aToken')
        localStorage.removeItem('dToken')
        window.dispatchEvent(new Event('auth:logout'))
      }
    }

    return Promise.reject(error)
  }
)

export default api

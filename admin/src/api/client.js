import axios from 'axios'

/** Empty in dev uses Vite proxy (/api → localhost:4000). Set VITE_BACKEND_URL for production. */
export const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || ''

const api = axios.create({
  baseURL: apiBaseUrl,
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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || ''
    const isLoginRequest = url.includes('/login')
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('aToken')
      localStorage.removeItem('dToken')
      window.dispatchEvent(new Event('auth:logout'))
    }
    return Promise.reject(error)
  }
)

export default api

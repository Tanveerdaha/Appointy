import axios from 'axios'

const DEFAULT_BACKEND_URL = 'http://localhost:4000'
export const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || DEFAULT_BACKEND_URL

const AUTH_PATHS = ['/api/user/login', '/api/user/register']

const api = axios.create({
  baseURL: apiBaseUrl,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.token = token
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || ''
    const isAuthAttempt = AUTH_PATHS.some((path) => url.includes(path))
    if (error.response?.status === 401 && !isAuthAttempt) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api

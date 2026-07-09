import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/** Redirects to login when session expires (401 from API). */
const AuthListener = () => {
  const navigate = useNavigate()

  useEffect(() => {
    const onLogout = () => navigate('/', { replace: true })
    window.addEventListener('auth:logout', onLogout)
    return () => window.removeEventListener('auth:logout', onLogout)
  }, [navigate])

  return null
}

export default AuthListener

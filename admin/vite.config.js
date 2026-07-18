import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = (env.VITE_BACKEND_URL || process.env.VITE_BACKEND_URL || '').trim()

  if (command === 'build' && !backendUrl) {
    throw new Error(
      'VITE_BACKEND_URL is required for production builds. ' +
        'Set it to the browser-reachable API URL (e.g. https://api.example.com).'
    )
  }

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  }
})

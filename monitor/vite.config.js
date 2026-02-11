import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const basicAuthPlugin = () => ({
  name: 'basic-auth',
  configureServer(server) {
    const password = process.env.TBC_PASSWORD
    if (!password) return
    server.middlewares.use((req, res, next) => {
      const auth = req.headers.authorization
      if (auth && auth.startsWith('Basic ')) {
        const decoded = Buffer.from(auth.slice(6), 'base64').toString()
        const [, pass] = decoded.split(':')
        if (pass === password) return next()
      }
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="TheBotCompany"' })
      res.end('Unauthorized')
    })
  }
})

export default defineConfig({
  plugins: [react(), basicAuthPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,  // Allow any host for dev tunnels
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
})

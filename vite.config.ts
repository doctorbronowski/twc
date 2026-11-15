import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    https:
      command === 'serve' && !isPreview
        ? {
            key: readFileSync(join(homedir(), '.certs', 'twc-key.pem')),
            cert: readFileSync(join(homedir(), '.certs', 'twc.pem')),
          }
        : undefined,
    allowedHosts: ['twc.local.com'],
    headers: {
      'Referrer-Policy': 'no-referrer',
    },
    proxy: {
      '/api': 'http://127.0.0.1:3002',
    },
  },
}))

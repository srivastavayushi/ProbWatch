import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages publishes project sites below /<repository-name>/.
  base: '/ProbWatch/',
  plugins: [react()],
})

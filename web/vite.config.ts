import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// React + ReactDOM stay external (loaded from esm.sh via the import map in
// index.html) so the built JS stays small enough to deploy through the
// Vercel file-upload path used here. If the deploy path changes to a git
// integration, this external block can be dropped and React bundled again.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    },
  },
})

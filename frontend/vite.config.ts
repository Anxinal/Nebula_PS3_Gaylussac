import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` must match the GitHub Pages path. For a project site served at
// https://<user>.github.io/<repo>/ this is "/<repo>/". Override with VITE_BASE
// (the deploy workflow sets it) or set it to "/" for a custom domain.
export default defineConfig(({ command, mode }) => ({
  // Only the built site lives under the repo sub-path; `npm run dev` serves at "/".
  base: command === 'build' ? (process.env.VITE_BASE ?? '/Nebula_PS3_Gaylussac/') : '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: mode !== 'production',
  },
}))

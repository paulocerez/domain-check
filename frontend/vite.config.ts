import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // The workspace package emits ESM to dist/ and is rebuilt by `tsc -b --watch`
  // during `npm run dev`; pre-bundling it would serve a stale copy.
  optimizeDeps: {
    exclude: ['@domain-check/shared'],
  },
  server: {
    port: 5173,
    // Always call the API same-origin as /api/... so CORS is a non-issue in dev,
    // and identical to production where the server serves this bundle itself.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Recharts is roughly half the bundle and only the dashboard uses it.
        // Splitting it keeps the table and detail views loading on their own.
        manualChunks: {
          charts: ['recharts'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})

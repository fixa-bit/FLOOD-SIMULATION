import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    host: true,
    watch: { ignored: ['**/.tmp/**', '**/.npm-cache/**', '**/test-results/**', '**/playwright-report/**'] },
  },
  // Vitest configuration
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
} as any);

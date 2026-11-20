import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // В Docker на Windows bind-mount не отдаёт FS-события — HMR без polling не работает
    watch: { usePolling: true, interval: 400 },
    proxy: {
      // В контейнере API доступен по имени сервиса, локально — по localhost
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});

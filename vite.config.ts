import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = `http://127.0.0.1:${env.PORT || 3000}`;

  return {
    root: 'client',
    envDir: process.cwd(),
    plugins: [react(), tailwind()],
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
      proxy: { '/api': backend, '/health': backend },
    },
    build: { outDir: '../dist', emptyOutDir: true },
  };
});

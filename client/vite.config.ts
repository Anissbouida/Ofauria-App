import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4173,
    // VITE_API_PROXY : viser un serveur local sur un autre port (verification
    // d'une branche pendant que le serveur principal tourne sur 3001).
    proxy: {
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:3001',
      '/uploads': process.env.VITE_API_PROXY ?? 'http://localhost:3001',
    },
  },
});

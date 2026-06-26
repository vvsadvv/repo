import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@pages': path.resolve(__dirname, 'src/pages'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@assets': path.resolve(__dirname, 'src/assets'),
      '@gsras': path.resolve(__dirname, 'src/gsras'),
      '@gsras-pages': path.resolve(__dirname, 'src/gsras/pages'),
      '@gsras-components': path.resolve(__dirname, 'src/gsras/components'),
      '@gsras-styles': path.resolve(__dirname, 'src/gsras/styles'),
      '@gsras-assets': path.resolve(__dirname, 'src/gsras/assets'),
      '@gsras-hooks': path.resolve(__dirname, 'src/gsras/hooks'),
      '@gsras-services': path.resolve(__dirname, 'src/gsras/services'),
      '@gsras-utils': path.resolve(__dirname, 'src/gsras/utils'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
    },
  },
});


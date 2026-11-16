import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@xyflow')) return 'tree';
          if (id.includes('firebase')) return 'firebase';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('/scheduler/'))
            return 'react';
        },
      },
    },
  },
});

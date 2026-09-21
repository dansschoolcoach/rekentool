import { defineConfig } from 'vite';
import { contrastViteConfig } from './playwright.contrast.config';

export default defineConfig({
  ...contrastViteConfig,
  optimizeDeps: {
    entries: ['contrast.html', 'route-protection.html'],
  },
  server: {
    port: 4174,
    strictPort: true,
  },
});
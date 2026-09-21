import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from '@playwright/test';

const artifactRoot = import.meta.dirname;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: [
    'financial-contrast.spec.ts',
    'season-draft-persistence.spec.ts',
    'route-protection.spec.ts',
    'onboarding-reload.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium' },
  },
  webServer: {
    command: 'VITE_PUBLIC_APP_URL=https://contrast.example.test pnpm exec vite --config vite.contrast.config.ts --host 127.0.0.1',
    url: 'http://127.0.0.1:4174/contrast.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

export const contrastViteConfig = {
  root: artifactRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(artifactRoot, 'src'),
      '@clerk/react/internal': path.resolve(artifactRoot, 'src/pages/financien/contrast/contrast-clerk.ts'),
      '@workspace/api-client-react': path.resolve(artifactRoot, 'src/pages/financien/contrast/contrast-api.ts'),
      '@clerk/react': path.resolve(artifactRoot, 'src/pages/financien/contrast/contrast-clerk.ts'),
      '@clerk/themes': path.resolve(artifactRoot, 'src/pages/financien/contrast/contrast-themes.ts'),
    },
  },
};
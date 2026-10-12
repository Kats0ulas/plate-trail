import { defineConfig, type Plugin } from 'vitest/config';

/**
 * The Content-Security-Policy lives in index.html and is what the built site ships with.
 * The dev server needs two relaxations that must never reach production:
 * inline <style> tags (Vite injects CSS that way) and the HMR websocket.
 */
function devCspRelax(): Plugin {
  return {
    name: 'dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/,
        (_m, a: string, csp: string, b: string) => {
          const relaxed = csp
            .replace(/style-src ([^;]*)/, "style-src $1 'unsafe-inline'")
            .replace(/connect-src ([^;]*)/, 'connect-src $1 ws: wss:');
          return a + relaxed + b;
        },
      );
    },
  };
}

export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/plate-trail/) and anywhere else.
  base: './',
  plugins: [devCspRelax()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      exclude: ['src/engine/worker.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});

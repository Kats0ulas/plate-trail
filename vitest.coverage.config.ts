import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vite.config';

/** Same as vite.config.ts, with the engine coverage report (and its 80% thresholds) switched on. */
export default mergeConfig(base, defineConfig({ test: { coverage: { enabled: true } } }));

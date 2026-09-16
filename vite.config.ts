/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // App build config: plain TS + Vite, no plugins needed for the scaffold.
  test: {
    environment: 'node', // engine/skills are WebGL-free — no DOM needed
    include: ['src/**/*.test.ts'],
  },
});
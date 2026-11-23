import { defineConfig } from 'vite';

// Content scripts cannot use ES module imports or shared chunks, so the
// content script is built on its own as a single IIFE bundle.
// Run after the main build; emptyOutDir must stay false to keep popup output.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/content/recorder.ts',
      formats: ['iife'],
      name: 'PercyRecorderContent',
      fileName: () => 'content.js'
    }
  }
});

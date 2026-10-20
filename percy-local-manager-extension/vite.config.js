import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Simple Manifest V3 popup build.
// manifest.json + icons live in /public and are copied to /dist as-is by Vite.
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                popup: 'index.html',
                library: 'library.html',
                snapshots: 'snapshots.html',
                // Service worker (ES module worker, may share chunks with the popup).
                background: 'src/background/recorder.ts'
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name].[ext]'
            }
        }
    }
});

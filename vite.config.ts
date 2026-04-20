import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    ...(mode === 'production'
      ? [babel({ presets: [reactCompilerPreset()] })]
      : []),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Journal',
        short_name: 'Journal',
        description: 'Premium markdown note-taking app powered by Homebase',
        theme_color: '#FDFCF8',
        background_color: '#FDFCF8',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ],
        shortcuts: [
          {
            name: "New Note",
            short_name: "New Note",
            description: "Create a new note",
            url: "/?action=new",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Search",
            short_name: "Search",
            description: "Search your notes",
            url: "/?action=search",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          }
        ],
        share_target: {
          action: "/share-target",
          method: "GET",
          enctype: "application/x-www-form-urlencoded",
          params: {
            title: "title",
            text: "text",
            url: "url"
          }
        }
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm,data,gz}'],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15 MB for large WASM files
      },
      devOptions: {
        enabled: false, // Disable in dev to avoid cache errors
        type: 'module',
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  server: {
    host: 'dev.dotyou.cloud',
    port: 5173,
    https: {
      key: fs.readFileSync('./dev-dotyou-cloud.key'),
      cert: fs.readFileSync('./dev-dotyou-cloud.crt'),
    },
    headers: {
      // Required for OPFS/WebLLM and SharedArrayBuffer
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      allow: ['..'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@mlc-ai/web-llm')) return 'web-llm';
          if (id.includes('@electric-sql/pglite')) return 'pglite';
          if (id.includes('@tiptap/')) return 'tiptap';
          if (id.includes('@radix-ui/react-dialog') || id.includes('@radix-ui/react-dropdown-menu') || id.includes('@radix-ui/react-popover')) return 'ui-libs';
        }
      }
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
}))

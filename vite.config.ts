import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"
import path from "path"
import legacy from '@vitejs/plugin-legacy'
import htmlPostBuildPlugin from './no-attr'

const base = './'


// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const isBuild = command == 'build'
  const plugins = [
    react(),
  ]
  plugins.push(legacy({
    targets: ['defaults', 'not IE 11'],
    additionalLegacyPolyfills: ['regenerator-runtime/runtime']
  }))
  plugins.push(htmlPostBuildPlugin(base) as any)
  return {
    plugins: plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    base: base,
    build: {
      outDir: "dist",
      assetsDir: "assets",
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom"],
            three: ["three"],
          },
        },
      },
    },
    server: {
      port: 5173,
      open: true,
    },
    preview: {
      port: 4173,
    },
  }
})

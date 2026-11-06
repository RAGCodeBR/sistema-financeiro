import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  // Relative paths keep the app functional on GitHub Pages project sites.
  base: './',
  plugins: [
    {
      name: 'local-statement-preview',
      configureServer(server) {
        // Only the dev server exposes the user's ignored local fixture.
        // The PDF is never in public/, source code or the production build.
        server.middlewares.use('/__local/itau-statement.pdf', (req, res) => {
          const fixture = path.resolve(__dirname, '.local', 'fatura-itau.pdf')
          const remote = req.socket.remoteAddress
          if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote || '') || !fs.existsSync(fixture)) {
            res.statusCode = 404
            res.end()
            return
          }
          res.setHeader('Content-Type', 'application/pdf')
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Content-Disposition', 'inline; filename="fatura-itau.pdf"')
          const stream = fs.createReadStream(fixture)
          stream.on('error', () => { res.statusCode = 500; res.end() })
          stream.pipe(res)
        })
      },
    },
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})

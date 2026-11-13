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

function localOcrAssets() {
  const coreDir = path.resolve(__dirname, 'node_modules/tesseract.js-core')
  const assets = new Map<string, string>([
    ['worker.min.js', path.resolve(__dirname, 'node_modules/tesseract.js/dist/worker.min.js')],
    ['worker.min.js.LICENSE.txt', path.resolve(__dirname, 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt')],
    ['tesseract-LICENSE.txt', path.resolve(__dirname, 'node_modules/tesseract.js/LICENSE.md')],
    ['tesseract-core-LICENSE.txt', path.resolve(__dirname, 'node_modules/tesseract.js-core/LICENSE')],
    ['por.traineddata.gz', path.resolve(__dirname, 'node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz')],
    ...fs.readdirSync(coreDir).filter(name => /^tesseract-core.*\.wasm(?:\.js)?$/.test(name)).map(name => [name, path.join(coreDir, name)] as [string, string]),
  ])
  return {
    name: 'local-ocr-assets',
    configureServer(server) {
      server.middlewares.use('/ocr/', (req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\//, '')
        const file = assets.get(name)
        if (!file) return next()
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const [name, file] of assets) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: fs.readFileSync(file) })
    },
  }
}

export default defineConfig({
  // Relative paths keep the app functional on GitHub Pages project sites.
  base: './',
  server: {
    // Private fiscal material and local documents are never static dev assets.
    fs: { deny: ['.env', '.env.*', '**/*.env', '**/.git/**', '**/.local/**', '**/*.pfx', '**/*.p12', '**/*.key', '**/*.pem'] },
  },
  plugins: [
    localOcrAssets(),
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

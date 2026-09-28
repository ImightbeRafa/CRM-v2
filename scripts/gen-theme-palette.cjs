// Writes src/app/theme-palette.css from src/lib/theme/palette.cjs. Run: npm run theme:gen
const fs = require('fs')
const path = require('path')
const { buildCss } = require('../src/lib/theme/palette.cjs')
const out = path.join(__dirname, '..', 'src', 'app', 'theme-palette.css')
fs.writeFileSync(out, buildCss())
console.log('wrote', path.relative(process.cwd(), out))

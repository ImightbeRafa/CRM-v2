// Writes src/app/theme-palette.css from src/lib/theme/palette.cjs and refreshes the dark value
// of every au-* token (aurora-hex-tokens.json) from classifyHex. Run: npm run theme:gen
const fs = require('fs')
const path = require('path')

const tokensFile = path.join(__dirname, '..', 'src', 'lib', 'theme', 'aurora-hex-tokens.json')
const { classifyHex } = require('../src/lib/theme/palette.cjs')
const ROLE_PROP = { ink: 'text', tint: 'bg', line: 'border' }

const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'))
for (const [name, t] of Object.entries(tokens)) {
  const role = name.split('-')[0]
  const next = classifyHex(ROLE_PROP[role], t.light)
  if (!next) throw new Error(`token ${name} no longer classifies`)
  t.dark = next.dark
}
fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2) + '\n')

// Re-read the palette so buildCss sees the refreshed token file.
delete require.cache[require.resolve('../src/lib/theme/palette.cjs')]
delete require.cache[tokensFile]
const { buildCss } = require('../src/lib/theme/palette.cjs')
const out = path.join(__dirname, '..', 'src', 'app', 'theme-palette.css')
fs.writeFileSync(out, buildCss())
console.log('wrote', path.relative(process.cwd(), out))

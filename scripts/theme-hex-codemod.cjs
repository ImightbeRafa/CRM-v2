// Dark-mode codemod: arbitrary-hex Tailwind classes → theme tokens (`au-*`).
//   node scripts/theme-hex-codemod.cjs          # rewrite files + src/lib/theme/aurora-hex-tokens.json
//   node scripts/theme-hex-codemod.cjs --check  # exit 1 if any convertible class is left
// Light value of every token = the original hex, so light mode is unchanged.
const fs = require('fs')
const path = require('path')
const { classifyHex } = require('../src/lib/theme/palette.cjs')

const ROOT = path.join(__dirname, '..', 'src')
const SKIP_DIRS = new Set(['logistics', 'home', '__tests__', 'node_modules'])
const SKIP_FILES = new Set(['ThemeChoice.tsx'])
const TOKENS_FILE = path.join(ROOT, 'lib', 'theme', 'aurora-hex-tokens.json')
const CLASS_RE = /\b(bg|text|border|ring|ring-offset|from|via|to|fill|stroke|divide|outline|placeholder|caret|decoration)-\[#([0-9A-Fa-f]{6})\]/g

const check = process.argv.includes('--check')
const tokens = fs.existsSync(TOKENS_FILE) ? JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')) : {}
const leftovers = []
let changedFiles = 0
let replaced = 0

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full)
    } else if (/\.(tsx?|jsx?)$/.test(name) && !SKIP_FILES.has(name)) {
      const src = fs.readFileSync(full, 'utf8')
      let hits = 0
      const next = src.replace(CLASS_RE, (m, prop, hex) => {
        const token = classifyHex(prop, '#' + hex.toUpperCase())
        if (!token) return m
        hits += 1
        if (check) {
          leftovers.push(`${path.relative(ROOT, full)}: ${m}`)
          return m
        }
        tokens[token.name] = { light: token.light, dark: token.dark }
        return `${prop}-au-${token.name}`
      })
      if (hits && !check) {
        fs.writeFileSync(full, next)
        changedFiles += 1
        replaced += hits
      }
    }
  }
}

walk(ROOT)
if (check) {
  if (leftovers.length) {
    console.log(`${leftovers.length} arbitrary-hex classes should use theme tokens:\n` + leftovers.join('\n'))
    process.exit(1)
  }
  console.log('ok: no convertible arbitrary-hex classes')
} else {
  const sorted = Object.fromEntries(Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`replaced ${replaced} classes in ${changedFiles} files; ${Object.keys(sorted).length} tokens`)
}

#!/usr/bin/env node
// Repo guard for Claude Code (local and cloud). Runs before every Bash call and
// blocks the actions that need Rafael's explicit GO (see CLAUDE.md "Always").
// Exit 2 = block; the stderr message is shown to the agent.
import { execSync } from 'node:child_process'

const PROTECTED = new Set(['dev', 'main', 'master'])

let raw = ''
for await (const chunk of process.stdin) raw += chunk
let cmd = ''
try {
  cmd = JSON.parse(raw)?.tool_input?.command ?? ''
} catch {
  process.exit(0)
}
if (!cmd) process.exit(0)

function block(reason) {
  process.stderr.write(`BLOCKED by .claude/hooks/guard.mjs: ${reason}. This needs Rafael's explicit GO; ask him to do it himself.\n`)
  process.exit(2)
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

// Check each chained segment on its own (&&, ||, ;, |, newlines).
for (const seg of cmd.split(/&&|\|\||[;|\n]/)) {
  const s = seg.trim()
  const words = s.split(/\s+/)

  // git push to dev/main/master (any refspec form), or --all/--mirror
  const pushAt = words.findIndex((w, i) => w === 'push' && words.slice(0, i).includes('git'))
  if (pushAt !== -1) {
    const args = words.slice(pushAt + 1)
    if (args.some((a) => a === '--all' || a === '--mirror')) block('git push --all/--mirror')
    const refs = args.filter((a) => !a.startsWith('-'))
    for (const ref of refs.slice(1)) {
      const target = ref.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '')
      if (PROTECTED.has(target)) block(`git push to ${target}`)
    }
    if (refs.length <= 1 && PROTECTED.has(currentBranch())) block(`git push while on ${currentBranch()}`)
  }

  // merges: PR merges always; local merges into dev/main/master
  if (/\bgh\s+pr\s+merge\b/.test(s)) block('gh pr merge')
  if (/\bgh\s+api\b.*\/merges?\b/.test(s)) block('merge through the GitHub API')
  if (/\bgit\b.*\bmerge\b/.test(s) && PROTECTED.has(currentBranch())) block(`git merge on ${currentBranch()}`)

  // deploys, secrets, CI triggers
  if (/\bwrangler\b.*\b(deploy|publish|secret|versions\s+deploy|rollback)\b/.test(s)) block('Cloudflare deploy/secret change')
  if (/\bnpm\s+run\s+cf:deploy\b/.test(s)) block('Cloudflare deploy')
  if (/\brailway\s+(up|redeploy|variables\s+set)\b/.test(s)) block('Railway deploy/variable change')
  if (/\bvercel\b.*(--prod|\bdeploy\b|\benv\s+(add|rm)\b)/.test(s)) block('Vercel deploy/env change')
  if (/\bgh\s+(workflow\s+run|secret\s+set|variable\s+set)\b/.test(s)) block('GitHub workflow run / secret change')

  // database schema changes (would drop the lm_* tables)
  if (/\bprisma\s+(db\s+push|migrate\s+(dev|deploy|reset))\b/.test(s)) block('prisma db push/migrate (drops lm_* tables)')
  if (/--accept-data-loss\b/.test(s)) block('--accept-data-loss')
  if (/\bALLOW_LM_DROP=/.test(s)) block('ALLOW_LM_DROP break-glass')
}

process.exit(0)

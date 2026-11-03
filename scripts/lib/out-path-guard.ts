/**
 * CRM161-13: --backup-dir / --out must be gitignored when inside the repo,
 * or under /tmp, or outside the repo root. Pure helpers + optional git check-ignore.
 */
import { execFileSync } from 'node:child_process'
import { isAbsolute, resolve, relative, sep } from 'node:path'

export function isUnderTmp(absPath: string): boolean {
  const n = resolve(absPath)
  return n === '/tmp' || n.startsWith(`/tmp${sep}`)
}

/** True when path is outside the repo. */
export function pathIsOutsideRepo(absPath: string, repoRoot: string): boolean {
  const root = resolve(repoRoot)
  const target = resolve(absPath)
  const rel = relative(root, target)
  return rel === '..' || rel.startsWith(`..${sep}`)
}

export function assertAllowedOutPath(
  pathInput: string,
  opts: {
    repoRoot: string
    label: string
    isGitIgnored?: (absPath: string) => boolean
  },
): string {
  const abs = isAbsolute(pathInput) ? resolve(pathInput) : resolve(opts.repoRoot, pathInput)
  if (isUnderTmp(abs) || pathIsOutsideRepo(abs, opts.repoRoot)) return abs
  const ignored = (opts.isGitIgnored ?? defaultGitIgnored)(abs)
  if (!ignored) {
    throw new Error(
      `Refusing ${opts.label}=${pathInput}: path is inside the repo and not gitignored. Use scripts/agent-pack/out/, scripts/agent-review/out/, --out=/tmp/…, or a path outside the repo.`,
    )
  }
  return abs
}

function defaultGitIgnored(absPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', absPath], { stdio: 'ignore' })
    return true
  } catch {
    try {
      execFileSync('git', ['check-ignore', '-q', resolve(absPath, '..')], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
}

export function resolveRepoOutPath(pathInput: string, label: string, repoRoot = process.cwd()): string {
  return assertAllowedOutPath(pathInput, { repoRoot, label })
}

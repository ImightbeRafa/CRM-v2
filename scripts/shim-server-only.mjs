/**
 * Node test preload: `server-only` throws under default Node resolution.
 * Next.js server builds resolve the react-server condition to a no-op;
 * unit tests need the same no-op so Prisma server modules can load.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const shimUrl = 'data:text/javascript,export {};'

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === 'server-only') {
        return { shortCircuit: true, url: ${JSON.stringify(shimUrl)}, format: 'module' }
      }
      return nextResolve(specifier, context)
    }
  `)}`,
  pathToFileURL('./'),
)

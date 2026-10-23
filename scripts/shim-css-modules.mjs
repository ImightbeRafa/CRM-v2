/**
 * Node test preload: CSS modules (`import s from './x.module.css'`) have no Node loader.
 * Next.js compiles them to class maps; unit tests get a map where each class name is itself,
 * so server-rendered markup still carries readable class names.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const stub = `data:text/javascript,${encodeURIComponent('export default new Proxy({}, { get: (_, key) => (typeof key === "string" ? key : undefined) })')}`

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (/\.module\.css$/.test(specifier)) {
        return { shortCircuit: true, url: ${JSON.stringify(stub)}, format: 'module' }
      }
      return nextResolve(specifier, context)
    }
  `)}`,
  pathToFileURL('./'),
)

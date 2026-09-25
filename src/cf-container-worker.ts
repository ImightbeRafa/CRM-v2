import { Container, getContainer } from "@cloudflare/containers";

// Cloudflare Worker entry for the daytime smoke deploy (see wrangler.jsonc).
// Not part of the Next.js app: excluded from the root tsconfig, checked by
// tsconfig.cf-worker.json, and bundled separately by wrangler.

interface Env {
  BETSY_CRM_CONTAINER: DurableObjectNamespace<BetsyCrmContainer>;
}

export class BetsyCrmContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";
}

export default {
  async fetch(request: Request, env: Env) {
    return getContainer(env.BETSY_CRM_CONTAINER).fetch(request);
  },
};

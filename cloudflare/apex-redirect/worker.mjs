// Apex redirect: betsycrm.com/* -> https://www.betsycrm.com/* (same path + query).
//
// Why: the app Worker (`betsy-crm-daytime-smoke`, root wrangler.jsonc) only has the
// `www.betsycrm.com/*` route. The apex DNS record is still the old Vercel target, so
// without this Worker the bare domain fell through to Vercel and showed
// "This deployment is temporarily paused" (Vercel DEPLOYMENT_DISABLED) on 2026-11-05.
// A Worker route wins over the DNS origin, so the apex never reaches Vercel again.
//
// GET/HEAD get 301 (cacheable, SEO). Other methods get 308 so a POST keeps its method
// and body (e.g. a webhook still configured with the apex URL).

const TARGET_ORIGIN = "https://www.betsycrm.com";

export default {
  fetch(request) {
    const url = new URL(request.url);
    const location = TARGET_ORIGIN + url.pathname + url.search;
    const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
    return new Response(null, {
      status,
      headers: {
        Location: location,
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
};

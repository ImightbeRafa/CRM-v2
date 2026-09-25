/**
 * Invoice and logistics PDFs use @sparticuz/chromium on Vercel/Lambda.
 * Containers set USE_SPARTICUZ_CHROMIUM=1 so they take the same path
 * (full puppeteer Chrome is not downloaded into the image).
 */
export function useSparticuzChromium(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME) return true;
  const flag = env.USE_SPARTICUZ_CHROMIUM;
  if (typeof flag !== 'string') return false;
  const value = flag.trim().toLowerCase();
  return value === '1' || value === 'true';
}

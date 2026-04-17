// next.config.js
/** @type {import('next').NextConfig} */
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/api/logistics/guias/generate-bulk': ['./src/lib/correos/wsdl/**/*'],
    '/api/shipping/generate-guia': ['./src/lib/correos/wsdl/**/*'],
    '/api/logistics/tracking': ['./src/lib/correos/wsdl/**/*'],
    '/api/logistics/tarifa': ['./src/lib/correos/wsdl/**/*'],
    '/api/logistics/correos-test': ['./src/lib/correos/wsdl/**/*'],
  },
  compress: true,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Server-side packages that should not be bundled
  serverExternalPackages: ['puppeteer', 'puppeteer-core', '@sparticuz/chromium', 'soap', 'axios'],

  // Image configuration
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'laplacelab.xyz' },
    ],
    unoptimized: false,
  },

  // Headers for security
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live https://app.tilopay.com https://accounts.google.com https://www.googletagmanager.com https://api.tokenex.com https://storage.googleapis.com https://connect.facebook.net https://staticxx.facebook.com https://www.facebook.com https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob: https://*.facebook.com https://*.fbcdn.net https://storage.googleapis.com https://vercel.com https://vercel.live https://*.vercel.app https://*.vercel-storage.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://app.tilopay.com https://api.tilopay.com https://api.tokenex.com https://vercel.live https://*.vercel-storage.com https://accounts.google.com https://connect.facebook.net https://graph.facebook.com https://www.facebook.com https://static.cloudflareinsights.com https://*.ingest.us.sentry.io",
              "worker-src 'self' blob:",
              "frame-src 'self' https://app.tilopay.com https://api.tokenex.com https://accounts.google.com https://www.facebook.com https://web.facebook.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
              "upgrade-insecure-requests"
            ].join('; ')
          },
          {
            key: 'Permissions-Policy',
            value: [
              'camera=()',
              'microphone=()',
              'geolocation=()',
              'interest-cohort=()'
            ].join(', ')
          }
        ]
      }
    ];
  },

  webpack: (config, { dev, isServer, webpack }) => {
    // Temporarily disabled webpack configuration to fix build issues
    
    // Production optimizations only
    if (!dev) {
      // Define a server-safe global 'self' to prevent SSR crashes from browser-only libs
      if (isServer) {
        // Ensure UMD wrappers use globalThis instead of self on server
        config.output = {
          ...config.output,
          globalObject: 'globalThis',
        }
        config.plugins.push(
          new webpack.DefinePlugin({
            self: 'globalThis',
          })
        )
      }
      // Optimize chunks only for client builds to avoid SSR runtime issues
      if (!isServer) {
        config.optimization = {
          ...config.optimization,
          minimize: true,
          moduleIds: 'deterministic',
          runtimeChunk: 'single',
          splitChunks: {
            chunks: 'all',
            minSize: 10000,
            maxSize: 20000000,
            cacheGroups: {
              vendor: {
                name: (module) => {
                  if (!module.context) return 'vendor.unknown';
                  const match = module.context.match(
                    /[\\/]node_modules[\\/](.*?)([\\/]|$)/
                  );
                  if (!match || !match[1]) return 'vendor.unknown';
                  const packageName = match[1];
                  return `vendor.${packageName.replace('@', '')}`;
                },
                test: /[\\/]node_modules[\\/]/,
                chunks: 'all',
                priority: 20,
                reuseExistingChunk: true,
                enforce: true,
              },
              commons: {
                name: 'commons',
                minChunks: 2,
                priority: 10,
                reuseExistingChunk: true,
                enforce: true,
              },
            },
          },
        };
      }
    }

    return config;
  },
};

export default withSentryConfig(bundleAnalyzer(nextConfig), {
  org: "betsy-v0",
  project: "javascript-nextjs",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  webpack: {
    automaticVercelMonitors: true,
    treeshake: { removeDebugLogging: true },
  },
});

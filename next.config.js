// next.config.js
/** @type {import('next').NextConfig} */
// import CompressionPlugin from 'compression-webpack-plugin';
import withBundleAnalyzer from '@next/bundle-analyzer';

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    // Add other environment variables here
  },
  // Add global polyfills for server-side rendering
  experimental: {
    serverComponentsExternalPackages: [],
  },

  // Domain configuration
  images: {
    domains: ['lh3.googleusercontent.com', 'laplacelab.xyz'],
    unoptimized: true,
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
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://accounts.google.com https://www.googletagmanager.com https://app.tilopay.com https://api.tokenex.com https://storage.googleapis.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://accounts.google.com https://app.tilopay.com https://api.tokenex.com",
              "frame-src 'self' https://accounts.google.com https://app.tilopay.com https://api.tokenex.com",
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
      // Enable compression - temporarily disabled for build issues
      // config.plugins.push(
      //   new CompressionPlugin({
      //     test: /\.(js|css|html|svg)$/,
      //     algorithm: 'gzip',
      //     threshold: 10240,
      //     minRatio: 0.8,
      //   })
      // );

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

export default bundleAnalyzer(nextConfig);
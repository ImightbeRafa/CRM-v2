// next.config.js
/** @type {import('next').NextConfig} */
const CompressionPlugin = require('compression-webpack-plugin');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
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
          }
        ]
      }
    ];
  },

  webpack: (config, { dev, isServer }) => {
    // Production optimizations only
    if (!dev) {
      // Enable compression
      config.plugins.push(
        new CompressionPlugin({
          test: /\.(js|css|html|svg)$/,
          algorithm: 'gzip',
          threshold: 10240,
          minRatio: 0.8,
        })
      );

      // Optimize chunks
      config.optimization = {
        ...config.optimization,
        minimize: true,
        moduleIds: 'deterministic',
        runtimeChunk: isServer ? false : 'single',
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

    return config;
  },
};

module.exports = withBundleAnalyzer(nextConfig);
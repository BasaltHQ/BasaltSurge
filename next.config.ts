// @ts-nocheck
// Types are noisy in Next config across versions; disable TS checks for this file.

import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig = {
  allowedDevOrigins: ['192.168.4.25'],
  experimental: {
    serverActions: {
      bodySizeLimit: '250mb',
    },
    proxyClientMaxBodySize: "250mb",
  },
  // Externalize problematic deep deps so Turbopack doesn't crawl their tests
  serverExternalPackages: ['pino', '@walletconnect/logger', 'thread-stream', 'mongodb'],

  // Transpile ESM Web3 packages that contain modern ES syntax (class static blocks, etc.)
  // so they are compiled to the standard backward-compatible Next.js target.
  transpilePackages: [
    "thirdweb",
    "viem",
    "ox",
    "abitype",
    "@coinbase/onchainkit",
    "porto",
    "@coinbase/wallet-sdk",
    "@walletconnect/sign-client",
    "@walletconnect/universal-provider",
    "@walletconnect/core",
    "@walletconnect/utils",
    "@noble/curves",
    "@noble/hashes",
    "@passwordless-id/webauthn",
    "mipd",
    "uqr",
    "@x402/core",
    "@x402/evm",
    "@x402/next"
  ],

  // Force-include mongodb adapter files in standalone output since they're
  // dynamically imported with webpackIgnore/turbopackIgnore and not traced.
  outputFileTracingIncludes: {
    '/**': ['./src/lib/db/**/*'],
  },

  // Ignore TypeScript errors during production builds (e.g., in Docker)
  typescript: {
    ignoreBuildErrors: true,
  },
  // Emit a minimal standalone server for Docker runtime stage
  // output: "standalone",
  staticPageGenerationTimeout: 300,
  images: {
    // Allow loading product and profile images from Azure Blob or Front Door
    remotePatterns: (() => {
      const blobHost = process.env.NEXT_PUBLIC_BLOB_HOSTNAME;
      const afdHost = process.env.NEXT_PUBLIC_AFD_HOSTNAME;
      const arr: { protocol: "https"; hostname: string; pathname: string }[] = [];
      if (blobHost) arr.push({ protocol: "https", hostname: blobHost, pathname: "/**" });
      if (afdHost) arr.push({ protocol: "https", hostname: afdHost, pathname: "/**" });
      // Add wildcard pattern for all Azure Front Door endpoints
      arr.push({ protocol: "https", hostname: "*.azurefd.net", pathname: "/**" });
      arr.push({ protocol: "https", hostname: "*.blob.core.windows.net", pathname: "/**" });

      // Allow OVHCloud Object Storage
      arr.push({ protocol: "https", hostname: "*.cloud.ovh.us", pathname: "/**" });

      return arr;
    })(),
    dangerouslyAllowSVG: true,
    // Limit image CSP to image/media directives only to avoid framing/popup blocks
    contentSecurityPolicy:
      "img-src 'self' data: blob: https:; media-src 'self' data: blob: https:",
  },
  // Add global headers for CSP and COOP to support embedded wallet flows
  async headers() {
    return [
      {
        source: "/(.*).(svg|jpg|jpeg|png|gif|ico|webp)",
        locale: false,
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "cross-origin",
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob: https:",
              "media-src 'self' data: blob: https:",
              // connect-src: Allow API calls to wallets, onramps, payment providers, and tracking (Clarity)
              "connect-src 'self' https: wss: https://explorer-api.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.com https://auth.privy.io https://*.rpc.privy.systems https://*.thirdweb.com https://*.coinbase.com https://stripe.com https://*.stripe.com https://*.ramp.network https://*.transak.com https://*.moonpay.com https://*.clarity.ms https://c.bing.com",
              // frame-src: Allow checkout widget iframes from onramp providers and Clarity
              "frame-src 'self' http: https: https://*.thirdweb.com https://*.coinbase.com https://stripe.com https://*.stripe.com https://*.ramp.network https://*.transak.com https://*.moonpay.com https://*.clarity.ms",
              "child-src 'self' blob: http: https: https://*.clarity.ms",
              "worker-src 'self' blob:",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: https://*.clarity.ms https://c.bing.com",
              "style-src 'self' 'unsafe-inline' https: https://use.typekit.net https://p.typekit.net",
              "font-src 'self' https: data: https://use.typekit.net https://p.typekit.net",
              "frame-ancestors *",
            ].join("; "),
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "unsafe-none",
          },
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    // Ignore test-only deps pulled in by deep logger deps (thread-stream tests)
    const IgnorePlugin = (require('webpack') as any).IgnorePlugin;
    config.plugins.push(new IgnorePlugin({
      resourceRegExp: /(tap|tape|fastbench|why-is-node-running|pino-elasticsearch|desm)$/,
    }));
    config.resolve = config.resolve || {} as any;
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      tap: false,
      tape: false,
      'why-is-node-running': false,
      fastbench: false,
      desm: false,
      'pino-elasticsearch': false,
    } as any;

    // Suppress source map warnings in development
    if (dev) {
      config.devtool = false;
    }

    return config;
  },

  async redirects() {
    return [
      {
        source: '/privacy',
        destination: '/legal/privacy',
        permanent: true,
      },
      {
        source: '/terms',
        destination: '/legal/terms',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/crypto-onramp/:path*",
        destination: "https://crypto-js.stripe.com/crypto-onramp/:path*",
      },
      {
        source: "/.well-known/farcaster.json",
        destination: "/api/farcaster/manifest",
      },
      {
        source: "/opengraph-image.png",
        destination: "/opengraph-image",
      },
    ];
  },
};

export default withNextIntl(nextConfig);

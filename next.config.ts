import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
// GitHub Pages hosts a static export, which cannot run API routes. Those builds stay
// fully local; every other build (Vercel, `next start`, `next dev`) adds server mode.
const isStaticExport = isGitHubPages || process.env.STATIC_EXPORT === 'true';
const isDev = process.env.NODE_ENV === 'development';
const driveConfigured = Boolean(
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && process.env.NEXT_PUBLIC_GOOGLE_API_KEY && process.env.NEXT_PUBLIC_GOOGLE_APP_ID,
);

// Content Security Policy for server builds (static hosts such as GitHub Pages cannot send headers).
// - connect-src 'self': page code cannot send media to any other server.
// - 'unsafe-inline': Next.js inline bootstrap scripts (no nonces on a static page).
// - 'unsafe-eval': the HEIC decoder (heic2any, Emscripten embind) builds functions at runtime.
// - 'wasm-unsafe-eval': the MI-GAN model and the HEIC decoder run as WebAssembly.
// - blob:: previews, results and the decoder's worker are object URLs.
// Google hosts are added only when the optional Drive picker is configured.
const google = driveConfigured
  ? {
      script: ' https://apis.google.com https://accounts.google.com',
      connect: ' https://www.googleapis.com https://content.googleapis.com',
      frame: 'https://docs.google.com https://drive.google.com https://accounts.google.com',
    }
  : { script: '', connect: '', frame: "'none'" };
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:${google.script}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src 'self' blob: data:${google.connect}${isDev ? ' ws:' : ''}`,
  "worker-src 'self' blob:",
  `frame-src ${google.frame}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Allows the Drive picker's sign-in popup while isolating the page from other windows.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: isStaticExport ? 'export' : undefined,
  trailingSlash: true,
  basePath: isGitHubPages ? '/gemini-watermark' : undefined,
  // API routes are named `route.server.ts`, so static exports never see them.
  pageExtensions: isStaticExport ? ['tsx', 'ts'] : ['tsx', 'ts', 'server.ts'],
  // Native or WebAssembly packages used only by server mode.
  serverExternalPackages: ['sharp', 'onnxruntime-web'],
  // The server reads the MI-GAN model from disk, so ship it with the clean function.
  outputFileTracingIncludes: {
    '/api/clean': [
      './public/vendor/models/migan-pipeline-v2.onnx',
      // ONNX Runtime loads its WebAssembly glue and binary at runtime, so tracing misses them.
      './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
      './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
    ],
  },
  // headers() is not supported by static exports, so the security headers are server builds only.
  ...(isStaticExport ? {} : {
    async headers() {
      return [{ source: '/:path*', headers: securityHeaders }];
    },
  }),
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? '/gemini-watermark' : '',
    NEXT_PUBLIC_SERVER_MODE: isStaticExport ? '' : '1',
  },
};

export default nextConfig;

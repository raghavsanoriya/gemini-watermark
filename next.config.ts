import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
// GitHub Pages hosts a static export, which cannot run API routes. Those builds stay
// fully local; every other build (Vercel, `next start`, `next dev`) adds server mode.
const isStaticExport = isGitHubPages || process.env.STATIC_EXPORT === 'true';

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
    '/api/clean': ['./public/vendor/models/migan-pipeline-v2.onnx'],
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? '/gemini-watermark' : '',
    NEXT_PUBLIC_SERVER_MODE: isStaticExport ? '' : '1',
  },
};

export default nextConfig;

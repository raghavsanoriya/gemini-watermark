import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: 'export',
  trailingSlash: true,
  basePath: isGitHubPages ? '/gemini-watermark' : undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? '/gemini-watermark' : '',
  },
};

export default nextConfig;

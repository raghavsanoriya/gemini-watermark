import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: 'export',
  trailingSlash: true,
  basePath: isGitHubPages ? '/gemini-watermark' : undefined,
};

export default nextConfig;

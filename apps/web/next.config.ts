import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // core é JS puro (ESM) no workspace; transpilar evita problemas de resolução no bundle.
  transpilePackages: ['@medcheckin/core'],
  serverExternalPackages: ['knex', 'pg'],
};

export default nextConfig;

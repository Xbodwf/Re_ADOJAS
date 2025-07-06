/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  trailingSlash: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true
  },
  //assetPrefix: process.env.NODE_ENV === 'production' ? './' : '',
  basePath: process.env.BASE_PATH || '',
  // 禁用服务器端功能
  experimental: {
    esmExternals: 'loose'
  }
}

export default nextConfig

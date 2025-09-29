/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  // 大きなファイルのアップロード対応
  api: {
    bodyParser: {
      sizeLimit: '100mb',
    },
  },
}

module.exports = nextConfig
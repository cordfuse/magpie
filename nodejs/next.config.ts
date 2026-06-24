import type { NextConfig } from 'next'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('./package.json')

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  env: { NEXT_PUBLIC_APP_VERSION: version },
}

export default withPWA(nextConfig)

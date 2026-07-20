import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,

  // pdfjs-dist precisa ser tratada como pacote externo no servidor
  serverExternalPackages: ['pdfjs-dist'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },

  async redirects() {
    return [
      {
        source: '/dashboard/ia-chat',
        destination: '/dashboard/ia?tab=chat',
        permanent: true,
      },
      {
        source: '/dashboard/ia-operacional',
        destination: '/dashboard/ia?tab=operacional',
        permanent: true,
      },
      {
        source: '/dashboard/assistente',
        destination: '/dashboard/ia?tab=canais',
        permanent: true,
      },
    ]
  },

  webpack: (config, { isServer }) => {
    // Habilita topLevelAwait para a pdfjs-dist (remove o warning amarelo)
    config.experiments = {
      ...config.experiments,
      topLevelAwait: true,
      asyncWebAssembly: true,
    }

    // pdfjs-dist só roda no cliente (navegador), não no servidor
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'pdfjs-dist': false,
      }
    }

    return config
  },
}

export default nextConfig

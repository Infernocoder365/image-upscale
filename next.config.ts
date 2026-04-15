import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    outputFileTracingIncludes: {
      // Bundle model weights and WASM runtime into every API route that upscales.
      // Without this, Vercel strips these files because static analysis can't
      // detect the dynamic fs.readFileSync calls at build time.
      '/api/upscale': [
        './node_modules/@upscalerjs/esrgan-thick/models/**/*',
        './node_modules/@tensorflow/tfjs-backend-wasm/wasm-out/**/*',
      ],
      '/api/upscale/chunked': [
        './node_modules/@upscalerjs/esrgan-thick/models/**/*',
        './node_modules/@tensorflow/tfjs-backend-wasm/wasm-out/**/*',
      ],
      '/api/upscale/split': [
        './node_modules/@upscalerjs/esrgan-thick/models/**/*',
        './node_modules/@tensorflow/tfjs-backend-wasm/wasm-out/**/*',
      ],
    },
  },
  serverExternalPackages: [
    'sharp',
    'upscaler',
    '@upscalerjs/esrgan-thick',
    '@tensorflow/tfjs',
    '@tensorflow/tfjs-core',
    '@tensorflow/tfjs-layers',
    '@tensorflow/tfjs-converter',
    '@tensorflow/tfjs-backend-cpu',
    '@tensorflow/tfjs-backend-webgl',
    '@tensorflow/tfjs-backend-wasm',
  ],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
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
    '@tensorflow/tfjs-node',
  ],
};

export default nextConfig;

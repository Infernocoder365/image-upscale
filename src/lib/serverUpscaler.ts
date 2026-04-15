/**
 * Server-side AI image upscaling using ESRGAN 4x via UpscalerJS model.
 *
 * Uses @tensorflow/tfjs with WASM backend for inference — no native build
 * tools required (works on Vercel and Windows).
 */
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';

// CJS-style requires so Next.js serverExternalPackages can resolve them
// without bundling (the .node.js CJS entry points are used at runtime).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tf = require('@tensorflow/tfjs') as typeof import('@tensorflow/tfjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tfWasm = require('@tensorflow/tfjs-backend-wasm') as typeof import('@tensorflow/tfjs-backend-wasm');

const SCALE = 4;
const MODEL_DIR = path.join(
  process.cwd(),
  'node_modules',
  '@upscalerjs',
  'esrgan-thick',
  'models',
  'x4'
);
const WASM_DIR = path.join(
  process.cwd(),
  'node_modules',
  '@tensorflow',
  'tfjs-backend-wasm',
  'wasm-out'
);

let initialized = false;
let initPromise: Promise<void> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModel: any = null;

async function _init(): Promise<void> {
  // 1. Register UpscalerJS custom layers (MultiplyBeta, PixelShuffleNx)
  //    These must be registered before loadLayersModel is called.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const modelConfig = require('@upscalerjs/esrgan-thick/4x');
  if (typeof modelConfig.setup === 'function') {
    modelConfig.setup(tf);
  }

  // 2. Configure & initialise WASM backend
  tfWasm.setWasmPaths(WASM_DIR + '/');
  await tf.setBackend('wasm');
  await tf.ready();

  // 3. Load ESRGAN model weights from local node_modules
  const modelJsonPath = path.join(MODEL_DIR, 'model.json');
  const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

  const weightBuffers: Buffer[] = modelJson.weightsManifest.flatMap(
    (manifest: { paths: string[] }) =>
      manifest.paths.map((p: string) => fs.readFileSync(path.join(MODEL_DIR, p)))
  );

  const totalLength = weightBuffers.reduce((acc, buf) => acc + buf.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of weightBuffers) {
    combined.set(buf, offset);
    offset += buf.length;
  }

  cachedModel = await tf.loadLayersModel({
    load: async () => ({
      modelTopology: modelJson.modelTopology,
      weightSpecs: modelJson.weightsManifest.flatMap(
        (m: { weights: object[] }) => m.weights
      ),
      weightData: combined.buffer,
    }),
  });

  initialized = true;
}

function init(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (!initPromise) initPromise = _init();
  return initPromise;
}

export interface AIUpscaleOptions {
  /** Input patch size in pixels (default 32). Larger = faster but more RAM. */
  patchSize?: number;
  /** Padding around each patch to reduce seam artefacts (default 4). */
  padding?: number;
  /** Called after each patch is processed. */
  onProgress?: (processed: number, total: number) => void;
}

/**
 * AI-upscale an image Buffer using ESRGAN 4× model.
 *
 * Returns a raw RGB pixel Buffer at 4× the input dimensions.
 * The caller is responsible for encoding it to the desired output format
 * (e.g. via sharp).
 */
export async function aiUpscaleBuffer(
  inputBuffer: Buffer,
  options: AIUpscaleOptions = {}
): Promise<{ rawBuffer: Buffer; width: number; height: number }> {
  await init();

  const { patchSize = 32, padding = 4, onProgress } = options;

  // Decode to raw RGB (remove alpha channel)
  const { data, info } = await sharp(inputBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const outWidth = width * SCALE;
  const outHeight = height * SCALE;

  // Normalise pixels to [0, 1] as Float32
  const inputFloat = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) inputFloat[i] = data[i] / 255;

  const outputPixels = new Uint8Array(outWidth * outHeight * 3);

  const step = patchSize;
  const chunksX = Math.ceil(width / step);
  const chunksY = Math.ceil(height / step);
  const totalChunks = chunksX * chunksY;
  let processed = 0;

  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      // Core patch bounds
      const x0 = cx * step;
      const y0 = cy * step;
      const x1 = Math.min(x0 + step, width);
      const y1 = Math.min(y0 + step, height);

      // Padded patch bounds (clamped to image edges)
      const px0 = Math.max(0, x0 - padding);
      const py0 = Math.max(0, y0 - padding);
      const px1 = Math.min(width, x1 + padding);
      const py1 = Math.min(height, y1 + padding);
      const pW = px1 - px0;
      const pH = py1 - py0;

      // Extract the padded patch as a flat float array
      const patchData = new Float32Array(pH * pW * 3);
      for (let y = 0; y < pH; y++) {
        for (let x = 0; x < pW; x++) {
          const si = ((py0 + y) * width + (px0 + x)) * 3;
          const di = (y * pW + x) * 3;
          patchData[di] = inputFloat[si];
          patchData[di + 1] = inputFloat[si + 1];
          patchData[di + 2] = inputFloat[si + 2];
        }
      }

      // Run ESRGAN on the padded patch
      const inputTensor = tf.tensor4d(patchData, [1, pH, pW, 3]);
      const rawOut = cachedModel.predict(inputTensor);
      const outputTensor = Array.isArray(rawOut) ? rawOut[0] : rawOut;
      const outputData = (await outputTensor.data()) as Float32Array;
      inputTensor.dispose();
      outputTensor.dispose();

      // Determine the valid (non-padded) region inside the upscaled output
      const outPadX0 = (x0 - px0) * SCALE;
      const outPadY0 = (y0 - py0) * SCALE;
      const validW = (x1 - x0) * SCALE;
      const validH = (y1 - y0) * SCALE;
      const outPatchW = pW * SCALE;
      const dstX = x0 * SCALE;
      const dstY = y0 * SCALE;

      for (let y = 0; y < validH; y++) {
        for (let x = 0; x < validW; x++) {
          const si = ((outPadY0 + y) * outPatchW + (outPadX0 + x)) * 3;
          const di = ((dstY + y) * outWidth + (dstX + x)) * 3;
          outputPixels[di] = Math.max(0, Math.min(255, Math.round(outputData[si] * 255)));
          outputPixels[di + 1] = Math.max(0, Math.min(255, Math.round(outputData[si + 1] * 255)));
          outputPixels[di + 2] = Math.max(0, Math.min(255, Math.round(outputData[si + 2] * 255)));
        }
      }

      processed++;
      if (onProgress) onProgress(processed, totalChunks);
    }
  }

  return {
    rawBuffer: Buffer.from(outputPixels.buffer),
    width: outWidth,
    height: outHeight,
  };
}

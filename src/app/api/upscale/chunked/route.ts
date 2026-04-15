import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument } from 'pdf-lib';
import { aiUpscaleBuffer } from '@/lib/serverUpscaler';

// Configure Sharp for large images
sharp.cache(false);
sharp.concurrency(1);

interface UpscaleOptions {
  outputWidth?: number;
  outputHeight?: number;
  dimensionUnit?: 'px' | 'in' | 'cm';
  targetDPI?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp' | 'pdf';
  quality?: number;
  chunkSize?: number;
}

async function updateProgress(
  jobId: string,
  progress: number,
  stage: string,
  message: string,
  status: 'processing' | 'completed' | 'error' = 'processing',
  result?: string,
  error?: string
) {
  try {
    await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/upscale/progress`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, progress, stage, message, status, result, error }),
      }
    );
  } catch (err) {
    console.error('Failed to update progress:', err);
  }
}

function convertToPixels(value: number, unit: string, dpi: number): number {
  switch (unit) {
    case 'in':
      return Math.round(value * dpi);
    case 'cm':
      return Math.round((value / 2.54) * dpi);
    case 'px':
    default:
      return value;
  }
}

/**
 * Process a large image in spatial chunks:
 *  1. Divide the input into chunks using Sharp extract.
 *  2. AI-upscale each chunk via ESRGAN 4× (UpscalerJS model).
 *  3. Composite the upscaled chunks onto a blank canvas.
 *  4. Resize to the requested target dimensions if they differ from the 4× output.
 */
async function processImageChunked(
  buffer: Buffer,
  targetWidth: number,
  targetHeight: number,
  options: UpscaleOptions,
  jobId: string
): Promise<Buffer> {
  const {
    outputFormat = 'jpeg',
    quality = 0.9,
    chunkSize = 512,
    targetDPI = 300,
  } = options;

  await updateProgress(jobId, 5, 'analyzing', 'Analysing source image…');

  const metadata = await sharp(buffer, { limitInputPixels: 500_000_000 }).metadata();
  const originalWidth = metadata.width!;
  const originalHeight = metadata.height!;

  const chunksX = Math.ceil(originalWidth / chunkSize);
  const chunksY = Math.ceil(originalHeight / chunkSize);
  const totalChunks = chunksX * chunksY;

  console.log(`Chunked processing: ${totalChunks} chunks (${chunksX}×${chunksY})`);

  // Native 4× output size from ESRGAN
  const aiWidth = originalWidth * 4;
  const aiHeight = originalHeight * 4;

  await updateProgress(jobId, 10, 'chunking', `Splitting into ${totalChunks} chunks…`);

  const compositeChunks: { input: Buffer; left: number; top: number }[] = [];

  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const chunkIndex = cy * chunksX + cx + 1;
      const progressPct = 10 + Math.round((chunkIndex / totalChunks) * 75); // 10–85 %

      await updateProgress(
        jobId,
        progressPct,
        'upscaling',
        `AI upscaling chunk ${chunkIndex}/${totalChunks}…`
      );

      // Extract chunk from original image
      const left = cx * chunkSize;
      const top = cy * chunkSize;
      const width = Math.min(chunkSize, originalWidth - left);
      const height = Math.min(chunkSize, originalHeight - top);

      const chunkBuffer = await sharp(buffer, { limitInputPixels: 500_000_000 })
        .extract({ left, top, width, height })
        .toBuffer();

      // AI-upscale the chunk (ESRGAN produces 4× per axis)
      const aiResult = await aiUpscaleBuffer(chunkBuffer, {
        patchSize: 32,
        padding: 4,
      });

      // Encode the raw RGB buffer to PNG for compositing
      const chunkPng = await sharp(aiResult.rawBuffer, {
        raw: { width: aiResult.width, height: aiResult.height, channels: 3 },
      })
        .png()
        .toBuffer();

      compositeChunks.push({
        input: chunkPng,
        left: left * 4,
        top: top * 4,
      });
    }
  }

  await updateProgress(jobId, 87, 'compositing', 'Compositing upscaled chunks…');

  // Composite all AI-upscaled chunks onto a blank canvas at native 4× size
  let pipeline = sharp({
    create: {
      width: aiWidth,
      height: aiHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
    limitInputPixels: 2_000_000_000,
  }).composite(compositeChunks);

  // Resize to requested target dimensions if different from native 4×
  if (targetWidth !== aiWidth || targetHeight !== aiHeight) {
    pipeline = pipeline.resize(targetWidth, targetHeight, {
      kernel: sharp.kernel.lanczos3,
      fit: 'fill',
    });
  }

  await updateProgress(jobId, 93, 'encoding', 'Encoding final image…');

  const isPdf = outputFormat === 'pdf';
  const rasterFormat = isPdf ? 'jpeg' : outputFormat;

  const rasterBuffer = await pipeline
    .withMetadata({ density: targetDPI })
    .toFormat(rasterFormat as keyof sharp.FormatEnum, {
      quality: Math.round(quality * 100),
      progressive: !isPdf,
    })
    .toBuffer();

  if (isPdf) {
    const pdfDoc = await PDFDocument.create();
    const jpgImage = await pdfDoc.embedJpg(rasterBuffer);
    const pageWidthPt = (targetWidth / targetDPI) * 72;
    const pageHeightPt = (targetHeight / targetDPI) * 72;
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    page.drawImage(jpgImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
    const pdfBytes = await pdfDoc.save();
    await updateProgress(jobId, 100, 'complete', 'Processing complete!', 'completed');
    return Buffer.from(pdfBytes);
  }

  await updateProgress(jobId, 100, 'complete', 'Processing complete!', 'completed');
  return rasterBuffer;
}

export async function POST(request: NextRequest) {
  const jobId = uuidv4();

  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;
    const optionsStr = formData.get('options') as string;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    const options: UpscaleOptions = optionsStr ? JSON.parse(optionsStr) : {};
    const { outputWidth, outputHeight, dimensionUnit = 'px', targetDPI = 300 } = options;

    await updateProgress(jobId, 0, 'starting', 'Initialising…');

    const buffer = Buffer.from(await file.arrayBuffer());

    const metadata = await sharp(buffer, { limitInputPixels: 500_000_000 }).metadata();
    const originalWidth = metadata.width!;
    const originalHeight = metadata.height!;

    await updateProgress(
      jobId,
      2,
      'analyzing',
      `Source image: ${originalWidth}×${originalHeight}px`
    );

    let targetWidth: number;
    let targetHeight: number;

    if (outputWidth && outputHeight) {
      targetWidth = convertToPixels(outputWidth, dimensionUnit, targetDPI);
      targetHeight = convertToPixels(outputHeight, dimensionUnit, targetDPI);
    } else {
      targetWidth = originalWidth * 4;
      targetHeight = originalHeight * 4;
    }

    const maxDimension = 100_000;
    const maxPixels = 2_000_000_000;

    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      await updateProgress(jobId, 0, 'error', 'Dimension too large.', 'error');
      return NextResponse.json(
        { error: `Dimension too large. Maximum ${maxDimension}px per side.`, jobId },
        { status: 400 }
      );
    }

    if (targetWidth * targetHeight > maxPixels) {
      await updateProgress(jobId, 0, 'error', 'Total pixels exceed limit.', 'error');
      return NextResponse.json(
        { error: `Total pixels exceed limit. Maximum ${maxPixels} pixels.`, jobId },
        { status: 400 }
      );
    }

    // Start async processing — return jobId immediately
    processImageChunked(buffer, targetWidth, targetHeight, options, jobId)
      .then(async (processedBuffer) => {
        const base64Result = processedBuffer.toString('base64');
        await updateProgress(
          jobId,
          100,
          'complete',
          'Processing complete!',
          'completed',
          base64Result
        );
      })
      .catch(async (err) => {
        console.error('Chunked processing error:', err);
        await updateProgress(
          jobId,
          0,
          'error',
          'Processing failed',
          'error',
          undefined,
          err instanceof Error ? err.message : String(err)
        );
      });

    return NextResponse.json({
      jobId,
      message: 'Processing started',
      targetDimensions: { width: targetWidth, height: targetHeight },
      estimatedTime: Math.ceil((targetWidth * targetHeight) / 10_000_000),
    });
  } catch (error) {
    console.error('Image processing error:', error);
    await updateProgress(
      jobId,
      0,
      'error',
      'Failed to start processing',
      'error',
      undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
    return NextResponse.json(
      {
        error: 'Failed to process image',
        details: error instanceof Error ? error.message : 'Unknown error',
        jobId,
      },
      { status: 500 }
    );
  }
}

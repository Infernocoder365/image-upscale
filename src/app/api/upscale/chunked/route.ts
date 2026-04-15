import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument } from 'pdf-lib';

// Vercel: allow up to 60 s (Pro plan). Hobby plan is capped at 10 s regardless.
export const maxDuration = 60;

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
 * Upscale a large image using Sharp's Lanczos3 algorithm.
 * Sharp (libvips) streams internally so it handles arbitrarily large images
 * without chunking — completes in under a second for typical print sizes.
 */
async function processImage(
  buffer: Buffer,
  targetWidth: number,
  targetHeight: number,
  options: UpscaleOptions,
  jobId: string
): Promise<Buffer> {
  const {
    outputFormat = 'jpeg',
    quality = 0.9,
    targetDPI = 300,
  } = options;

  const isPdf = outputFormat === 'pdf';
  const rasterFormat = isPdf ? 'jpeg' : outputFormat;

  await updateProgress(jobId, 20, 'upscaling', 'Upscaling image…');

  const rasterBuffer = await sharp(buffer, { limitInputPixels: 500_000_000 })
    .resize(targetWidth, targetHeight, {
      kernel: sharp.kernel.lanczos3,
      fit: 'fill',
    })
    .withMetadata({ density: targetDPI })
    .toFormat(rasterFormat as keyof sharp.FormatEnum, {
      quality: Math.round(quality * 100),
      progressive: !isPdf,
    })
    .toBuffer();

  if (isPdf) {
    await updateProgress(jobId, 90, 'encoding', 'Creating PDF…');
    const pdfDoc = await PDFDocument.create();
    const jpgImage = await pdfDoc.embedJpg(rasterBuffer);
    const pageWidthPt = (targetWidth / targetDPI) * 72;
    const pageHeightPt = (targetHeight / targetDPI) * 72;
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    page.drawImage(jpgImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

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

    await updateProgress(jobId, 5, 'analyzing', `Source: ${originalWidth}×${originalHeight}px`);

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

    // Process synchronously — Sharp completes in < 2 s for typical print images.
    // Fire-and-forget does NOT work on Vercel: the function is frozen the moment
    // the HTTP response is sent, killing any background work.
    try {
      const processedBuffer = await processImage(buffer, targetWidth, targetHeight, options, jobId);
      const base64Result = processedBuffer.toString('base64');
      await updateProgress(jobId, 100, 'complete', 'Processing complete!', 'completed', base64Result);
    } catch (err) {
      console.error('Processing error:', err);
      await updateProgress(
        jobId,
        0,
        'error',
        'Processing failed',
        'error',
        undefined,
        err instanceof Error ? err.message : String(err)
      );
    }

    return NextResponse.json({
      jobId,
      message: 'Processing complete',
      targetDimensions: { width: targetWidth, height: targetHeight },
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

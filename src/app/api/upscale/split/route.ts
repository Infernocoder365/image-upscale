import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

// Vercel: allow up to 60 s (Pro plan). Hobby plan is capped at 10 s regardless.
export const maxDuration = 60;

sharp.cache(false);
sharp.concurrency(1);

interface SplitOptions {
  realWidthInches: number;
  realHeightInches: number;
  rollPartWidthInches: number;
  targetDPI?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
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

async function processSplit(
  buffer: Buffer,
  options: SplitOptions,
  jobId: string
): Promise<void> {
  const {
    realWidthInches,
    realHeightInches,
    rollPartWidthInches,
    targetDPI = 300,
    outputFormat = 'png',
    quality = 0.95,
  } = options;

  await updateProgress(jobId, 2, 'analyzing', 'Analysing source image…');

  const metadata = await sharp(buffer, { limitInputPixels: 500_000_000 }).metadata();
  const originalWidth = metadata.width!;
  const originalHeight = metadata.height!;

  const totalParts = Math.ceil(realWidthInches / rollPartWidthInches);
  const pixelsPerInch = originalWidth / realWidthInches;

  await updateProgress(jobId, 5, 'chunking', `Splitting into ${totalParts} parts…`);

  const parts: string[] = [];
  const partWidthPx = Math.round(rollPartWidthInches * targetDPI);
  const partHeightPx = Math.round(realHeightInches * targetDPI);

  for (let i = 0; i < totalParts; i++) {
    const progressPct = 5 + Math.round((i / totalParts) * 88);
    await updateProgress(
      jobId,
      progressPct,
      'upscaling',
      `Upscaling part ${i + 1}/${totalParts}…`
    );

    const srcLeft = Math.round(i * rollPartWidthInches * pixelsPerInch);
    const actualPartWidthInches = Math.min(
      rollPartWidthInches,
      realWidthInches - i * rollPartWidthInches
    );
    const srcWidth = Math.round(actualPartWidthInches * pixelsPerInch);
    const srcHeight = originalHeight;

    const targetW = Math.round(actualPartWidthInches * targetDPI);
    const targetH = partHeightPx;

    // Extract this slice, resize to target DPI dimensions with Lanczos3
    const encodedPart = await sharp(buffer, { limitInputPixels: 500_000_000 })
      .extract({ left: srcLeft, top: 0, width: srcWidth, height: srcHeight })
      .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
      .toFormat(outputFormat as keyof sharp.FormatEnum, {
        quality: Math.round(quality * 100),
      })
      .toBuffer();

    parts.push(encodedPart.toString('base64'));
  }

  await updateProgress(jobId, 95, 'encoding', 'Finalising…');

  const splitResult = JSON.stringify({
    parts,
    totalParts,
    partDimensions: { widthPx: partWidthPx, heightPx: partHeightPx },
    metadata: {
      originalRealWidth: realWidthInches,
      originalRealHeight: realHeightInches,
      rollPartWidth: rollPartWidthInches,
      targetDPI,
    },
  });

  await updateProgress(jobId, 100, 'complete', 'Split upscale complete!', 'completed', splitResult);
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

    const options: SplitOptions = optionsStr ? JSON.parse(optionsStr) : {};

    if (!options.realWidthInches || !options.realHeightInches || !options.rollPartWidthInches) {
      return NextResponse.json(
        { error: 'realWidthInches, realHeightInches and rollPartWidthInches are required' },
        { status: 400 }
      );
    }

    if (options.rollPartWidthInches > options.realWidthInches) {
      return NextResponse.json(
        { error: 'Roll part width cannot exceed total image width' },
        { status: 400 }
      );
    }

    await updateProgress(jobId, 0, 'starting', 'Initialising split upscale…');

    const buffer = Buffer.from(await file.arrayBuffer());

    // Process synchronously before returning — Vercel kills background tasks
    // when the HTTP response is sent, so fire-and-forget does not work there.
    try {
      await processSplit(buffer, options, jobId);
    } catch (err) {
      console.error('Split processing error:', err);
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
      type: 'split',
      message: 'Split upscale complete',
      totalParts: Math.ceil(options.realWidthInches / options.rollPartWidthInches),
    });
  } catch (error) {
    console.error('Split upscale error:', error);
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

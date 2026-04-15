import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
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

function validateDimensions(width: number, height: number) {
  const maxDimension = 50000;
  const maxPixels = 500_000_000;

  if (width > maxDimension || height > maxDimension) {
    return {
      isValid: false,
      error: `Dimension too large. Maximum ${maxDimension}px per side.`,
      maxWidth: maxDimension,
      maxHeight: maxDimension,
    };
  }
  if (width * height > maxPixels) {
    const ratio = Math.sqrt(maxPixels / (width * height));
    return {
      isValid: false,
      error: `Total pixels exceed limit. Maximum ${maxPixels} pixels.`,
      maxWidth: Math.floor(width * ratio),
      maxHeight: Math.floor(height * ratio),
    };
  }
  return { isValid: true };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;
    const optionsStr = formData.get('options') as string;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    const options: UpscaleOptions = optionsStr ? JSON.parse(optionsStr) : {};
    const {
      outputWidth,
      outputHeight,
      dimensionUnit = 'px',
      targetDPI = 300,
      outputFormat = 'jpeg',
      quality = 0.9,
    } = options;

    const isPdf = outputFormat === 'pdf';
    const rasterFormat = isPdf ? 'jpeg' : outputFormat;

    const buffer = Buffer.from(await file.arrayBuffer());

    const metadata = await sharp(buffer, { limitInputPixels: 500_000_000 }).metadata();
    const originalWidth = metadata.width!;
    const originalHeight = metadata.height!;

    console.log(`Processing image: ${originalWidth}x${originalHeight}px`);

    let targetWidth: number;
    let targetHeight: number;

    if (outputWidth && outputHeight) {
      targetWidth = convertToPixels(outputWidth, dimensionUnit, targetDPI);
      targetHeight = convertToPixels(outputHeight, dimensionUnit, targetDPI);
    } else {
      targetWidth = originalWidth * 4;
      targetHeight = originalHeight * 4;
    }

    console.log(`Target dimensions: ${targetWidth}x${targetHeight}px`);

    const validation = validateDimensions(targetWidth, targetHeight);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error, maxWidth: validation.maxWidth, maxHeight: validation.maxHeight },
        { status: 400 }
      );
    }

    // High-quality Lanczos3 upscale via Sharp (libvips) — completes in milliseconds
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

    console.log(`Upscale complete: ${targetWidth}x${targetHeight}px, ${rasterBuffer.length} bytes`);

    if (isPdf) {
      const pdfDoc = await PDFDocument.create();
      const jpgImage = await pdfDoc.embedJpg(rasterBuffer);

      const pageWidthPt = (targetWidth / targetDPI) * 72;
      const pageHeightPt = (targetHeight / targetDPI) * 72;

      const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
      page.drawImage(jpgImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });

      const pdfBytes = await pdfDoc.save();
      console.log(`PDF output size: ${pdfBytes.length} bytes`);

      return new NextResponse(pdfBytes.buffer as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': pdfBytes.length.toString(),
          'Content-Disposition': 'attachment; filename="upscaled.pdf"',
          'X-Upscale-Method': 'Lanczos3',
        },
      });
    }

    return new NextResponse(new Uint8Array(rasterBuffer), {
      headers: {
        'Content-Type': `image/${rasterFormat}`,
        'Content-Length': rasterBuffer.length.toString(),
        'Content-Disposition': `attachment; filename="upscaled.${rasterFormat}"`,
        'X-Upscale-Method': 'Lanczos3',
      },
    });
  } catch (error) {
    console.error('Image processing error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process image',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Image upscaling API endpoint (Lanczos3 via Sharp/libvips)',
    maxDimension: 50000,
    maxPixels: 500_000_000,
    supportedFormats: ['jpeg', 'png', 'webp', 'pdf'],
    supportedUnits: ['px', 'in', 'cm'],
    upscaleMethod: 'Lanczos3',
  });
}

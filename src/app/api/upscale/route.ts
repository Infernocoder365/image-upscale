import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import Upscaler from 'upscaler';

// Configure Sharp for large images
sharp.cache(false);
sharp.concurrency(1);

interface UpscaleOptions {
  outputWidth?: number;
  outputHeight?: number;
  dimensionUnit?: 'px' | 'in' | 'cm';
  targetDPI?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  quality?: number;
}

// Initialize upscaler with server-side model
let upscaler: InstanceType<typeof Upscaler> | null = null;

async function getUpscaler() {
  if (!upscaler) {
    upscaler = new Upscaler({
      model: {
        path: 'https://models.upscalerjs.com/esrgan-thick/4x/model.json',
        scale: 4
      }
    });
  }
  return upscaler;
}

// Convert dimensions to pixels based on unit and DPI
function convertToPixels(value: number, unit: string, dpi: number): number {
  switch (unit) {
    case 'in':
      return Math.round(value * dpi);
    case 'cm':
      return Math.round(value * dpi / 2.54);
    case 'px':
    default:
      return value;
  }
}

// Validate image dimensions for server processing
function validateDimensions(width: number, height: number) {
  const maxDimension = 50000; // Server can handle larger images than browser
  const maxPixels = 500000000; // 500MP limit for server
  
  if (width > maxDimension || height > maxDimension) {
    return {
      isValid: false,
      error: `Dimension too large. Maximum ${maxDimension}px per side.`,
      maxWidth: maxDimension,
      maxHeight: maxDimension
    };
  }
  
  if (width * height > maxPixels) {
    const ratio = Math.sqrt(maxPixels / (width * height));
    return {
      isValid: false,
      error: `Total pixels exceed limit. Maximum ${maxPixels} pixels.`,
      maxWidth: Math.floor(width * ratio),
      maxHeight: Math.floor(height * ratio)
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
      quality = 0.9
    } = options;
    
    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Get image metadata
    const metadata = await sharp(buffer, { limitInputPixels: 500000000 }).metadata();
    const originalWidth = metadata.width!;
    const originalHeight = metadata.height!;
    
    console.log(`Processing image: ${originalWidth}x${originalHeight}px`);
    
    // Calculate target dimensions
    let targetWidth: number;
    let targetHeight: number;
    
    if (outputWidth && outputHeight) {
      // Convert to pixels if needed
      targetWidth = convertToPixels(outputWidth, dimensionUnit, targetDPI);
      targetHeight = convertToPixels(outputHeight, dimensionUnit, targetDPI);
    } else {
      // Default to 4x upscale
      targetWidth = originalWidth * 4;
      targetHeight = originalHeight * 4;
    }
    
    console.log(`Target dimensions: ${targetWidth}x${targetHeight}px`);
    
    // Validate dimensions
    const validation = validateDimensions(targetWidth, targetHeight);
    if (!validation.isValid) {
      return NextResponse.json({ 
        error: validation.error,
        maxWidth: validation.maxWidth,
        maxHeight: validation.maxHeight
      }, { status: 400 });
    }
    
    // Process image with Sharp for large dimensions
    let processedBuffer: Buffer;
    
    if (targetWidth > originalWidth * 4 || targetHeight > originalHeight * 4) {
      // For very large outputs, use Sharp's high-quality resizing
      console.log('Using Sharp for large image processing');
      processedBuffer = await sharp(buffer, { limitInputPixels: 500000000 })
        .resize(targetWidth, targetHeight, {
          kernel: sharp.kernel.lanczos3,
          fit: 'fill'
        })
        .toFormat(outputFormat as any, { 
          quality: Math.round(quality * 100),
          progressive: true
        })
        .toBuffer();
    } else {
      // Use high-quality Sharp upscaling
      console.log('Using Sharp upscaling');
      
      processedBuffer = await sharp(buffer, { limitInputPixels: 500000000 })
        .resize(targetWidth, targetHeight, {
          kernel: sharp.kernel.lanczos3,
          fit: 'fill'
        })
        .toFormat(outputFormat as any, { 
          quality: Math.round(quality * 100),
          progressive: true
        })
        .toBuffer();
      
      // Processing complete
    }
    
    console.log(`Processed image size: ${processedBuffer.length} bytes`);
    
    // Return the processed image
    return new NextResponse(processedBuffer, {
      headers: {
        'Content-Type': `image/${outputFormat}`,
        'Content-Length': processedBuffer.length.toString(),
        'Content-Disposition': `attachment; filename="upscaled.${outputFormat}"`
      }
    });
    
  } catch (error) {
    console.error('Image processing error:', error);
    return NextResponse.json({ 
      error: 'Failed to process image',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ 
    message: 'Image upscaling API endpoint',
    maxDimension: 50000,
    maxPixels: 500000000,
    supportedFormats: ['jpeg', 'png', 'webp'],
    supportedUnits: ['px', 'in', 'cm']
  });
}
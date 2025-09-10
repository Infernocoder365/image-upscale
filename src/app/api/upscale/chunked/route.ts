import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import Upscaler from 'upscaler';
import { v4 as uuidv4 } from 'uuid';

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
  chunkSize?: number;
}

// Progress tracking
async function updateProgress(jobId: string, progress: number, stage: string, message: string, status: 'processing' | 'completed' | 'error' = 'processing', result?: string, error?: string) {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/upscale/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, progress, stage, message, status, result, error })
    });
  } catch (err) {
    console.error('Failed to update progress:', err);
  }
}

// Initialize upscaler
// const upscaler: InstanceType<typeof Upscaler> | null = null;

/*
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
*/

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

// Process image in chunks for extremely large outputs
async function processImageChunked(
  buffer: Buffer,
  targetWidth: number,
  targetHeight: number,
  options: UpscaleOptions,
  jobId: string
): Promise<Buffer> {
  const { outputFormat = 'jpeg', quality = 0.9, chunkSize = 2048 } = options;
  
  await updateProgress(jobId, 10, 'chunking', 'Preparing image chunks...');
  
  // Get original image metadata
  const metadata = await sharp(buffer, { limitInputPixels: 500000000 }).metadata();
  const originalWidth = metadata.width!;
  const originalHeight = metadata.height!;
  
  // Calculate scale factors
  const scaleX = targetWidth / originalWidth;
  const scaleY = targetHeight / originalHeight;
  
  // Determine chunk dimensions in original image space
  const chunkOriginalWidth = Math.floor(chunkSize / scaleX);
  const chunkOriginalHeight = Math.floor(chunkSize / scaleY);
  
  // Calculate number of chunks
  const chunksX = Math.ceil(originalWidth / chunkOriginalWidth);
  const chunksY = Math.ceil(originalHeight / chunkOriginalHeight);
  const totalChunks = chunksX * chunksY;
  
  console.log(`Processing ${totalChunks} chunks (${chunksX}x${chunksY})`);
  
  // Create output canvas
  const outputImage = sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    },
    limitInputPixels: 500000000
  });
  
  const processedChunks: { input: Buffer; left: number; top: number }[] = [];
  
  // Process each chunk
  for (let y = 0; y < chunksY; y++) {
    for (let x = 0; x < chunksX; x++) {
      const chunkIndex = y * chunksX + x + 1;
      const progressPercent = Math.round((chunkIndex / totalChunks) * 80) + 10; // 10-90%
      
      await updateProgress(
        jobId,
        progressPercent,
        'processing',
        `Processing chunk ${chunkIndex}/${totalChunks}...`
      );
      
      // Calculate chunk boundaries in original image
      const left = x * chunkOriginalWidth;
      const top = y * chunkOriginalHeight;
      const width = Math.min(chunkOriginalWidth, originalWidth - left);
      const height = Math.min(chunkOriginalHeight, originalHeight - top);
      
      // Extract chunk from original image
      const chunkBuffer = await sharp(buffer, { limitInputPixels: 500000000 })
        .extract({ left, top, width, height })
        .toBuffer();
      
      // Upscale chunk
      let processedChunk: Buffer;
      
      if (scaleX > 4 || scaleY > 4) {
        // Use Sharp for large scaling
        const chunkTargetWidth = Math.round(width * scaleX);
        const chunkTargetHeight = Math.round(height * scaleY);
        
        processedChunk = await sharp(chunkBuffer, { limitInputPixels: 500000000 })
          .resize(chunkTargetWidth, chunkTargetHeight, {
            kernel: sharp.kernel.lanczos3,
            fit: 'fill'
          })
          .toBuffer();
      } else {
        // Use high-quality Sharp upscaling
        const chunkTargetWidth = Math.round(width * scaleX);
        const chunkTargetHeight = Math.round(height * scaleY);
        
        processedChunk = await sharp(chunkBuffer, { limitInputPixels: 500000000 })
          .resize(chunkTargetWidth, chunkTargetHeight, {
            kernel: sharp.kernel.lanczos3,
            fit: 'fill'
          })
          .toBuffer();
      }
      
      // Calculate position in output image
      const outputLeft = Math.round(left * scaleX);
      const outputTop = Math.round(top * scaleY);
      
      processedChunks.push({
        input: processedChunk,
        left: outputLeft,
        top: outputTop
      });
    }
  }
  
  await updateProgress(jobId, 90, 'compositing', 'Combining processed chunks...');
  
  // Composite all chunks into final image
  const finalImage = await outputImage
    .composite(processedChunks)
    .toFormat(outputFormat as keyof sharp.FormatEnum, {
      quality: Math.round(quality * 100),
      progressive: true
    })
    .toBuffer();
  
  await updateProgress(jobId, 100, 'complete', 'Image processing completed!', 'completed');
  
  return finalImage;
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
    const {
      outputWidth,
      outputHeight,
      dimensionUnit = 'px',
      targetDPI = 300
      // outputFormat = 'jpeg'
      // quality = 0.9
    } = options;
    
    await updateProgress(jobId, 0, 'starting', 'Initializing image processing...');
    
    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Get image metadata
    const metadata = await sharp(buffer, { limitInputPixels: 500000000 }).metadata();
    const originalWidth = metadata.width!;
    const originalHeight = metadata.height!;
    
    await updateProgress(jobId, 5, 'analyzing', `Analyzing image: ${originalWidth}x${originalHeight}px`);
    
    // Calculate target dimensions
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
    
    // Validate dimensions (more generous for chunked processing)
    const maxDimension = 100000; // 100k pixels per side for chunked processing
    const maxPixels = 2000000000; // 2GP limit for chunked processing
    
    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      await updateProgress(jobId, 0, 'error', `Dimension too large. Maximum ${maxDimension}px per side.`, 'error');
      return NextResponse.json({ 
        error: `Dimension too large. Maximum ${maxDimension}px per side.`,
        jobId
      }, { status: 400 });
    }
    
    if (targetWidth * targetHeight > maxPixels) {
      await updateProgress(jobId, 0, 'error', `Total pixels exceed limit. Maximum ${maxPixels} pixels.`, 'error');
      return NextResponse.json({ 
        error: `Total pixels exceed limit. Maximum ${maxPixels} pixels.`,
        jobId
      }, { status: 400 });
    }
    
    // Start processing asynchronously
    processImageChunked(buffer, targetWidth, targetHeight, options, jobId)
      .then(async (processedBuffer) => {
        // Store result (in production, save to file storage)
        const base64Result = processedBuffer.toString('base64');
        await updateProgress(jobId, 100, 'complete', 'Processing completed successfully!', 'completed', base64Result);
      })
      .catch(async (error) => {
        console.error('Chunked processing error:', error);
        await updateProgress(jobId, 0, 'error', 'Processing failed', 'error', undefined, error.message);
      });
    
    // Return job ID immediately
    return NextResponse.json({ 
      jobId,
      message: 'Processing started',
      targetDimensions: { width: targetWidth, height: targetHeight },
      estimatedTime: Math.ceil((targetWidth * targetHeight) / 10000000) // rough estimate in seconds
    });
    
  } catch (error) {
    console.error('Image processing error:', error);
    await updateProgress(jobId, 0, 'error', 'Failed to start processing', 'error', undefined, error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ 
      error: 'Failed to process image',
      details: error instanceof Error ? error.message : 'Unknown error',
      jobId
    }, { status: 500 });
  }
}
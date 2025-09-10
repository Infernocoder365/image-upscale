import Upscaler from 'upscaler';
import model from '@upscalerjs/esrgan-thick/4x';

export type DimensionUnit = 'px' | 'in' | 'cm';

export interface UpscaleOptions {
  targetDPI?: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  maxFileSize?: number;
  outputWidth?: number;
  outputHeight?: number;
  dimensionUnit?: DimensionUnit;
  preserveAspectRatio?: boolean;
}

export interface SplitUpscaleOptions {
  realWidthInches: number;
  realHeightInches: number;
  rollPartWidthInches: number;
  targetDPI?: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  quality?: number;
}

export interface SplitUpscaleResult {
  parts: string[]; // Base64 encoded images
  totalParts: number;
  partDimensions: {
    widthPx: number;
    heightPx: number;
  };
  metadata: {
    originalRealWidth: number;
    originalRealHeight: number;
    rollPartWidth: number;
    targetDPI: number;
  };
}

export interface UpscaleProgress {
  progress: number;
  stage: 'loading' | 'processing' | 'complete' | 'error' | 'starting' | 'analyzing' | 'chunking' | 'upscaling' | 'compositing' | 'resizing';
  message?: string;
}

class ImageUpscalerService {
  private upscaler: InstanceType<typeof Upscaler> | null = null;
  private progressCallback?: (progress: UpscaleProgress) => void;

  constructor() {
    this.upscaler = new Upscaler({
      model,
    });
  }

  setProgressCallback(callback: (progress: UpscaleProgress) => void) {
    this.progressCallback = callback;
  }

  private cleanupMemory() {
    // Force garbage collection if available
    if (typeof window !== 'undefined' && 'gc' in window) {
      (window as any).gc();
    }
  }

  private async processWithMemoryManagement<T>(
    operation: () => Promise<T>,
    cleanupFn?: () => void
  ): Promise<T> {
    try {
      const result = await operation();
      return result;
    } finally {
      if (cleanupFn) cleanupFn();
      this.cleanupMemory();
      // Add small delay to allow cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private updateProgress(progress: UpscaleProgress) {
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }

  private calculateDPIScale(currentDPI: number, targetDPI: number = 300): number {
    return targetDPI / currentDPI;
  }

  private async processImageInChunks(
    canvas: HTMLCanvasElement,
    chunkSize: number = 1024
  ): Promise<string> {
    const ctx = canvas.getContext('2d')!;
    const { width, height } = canvas;
    
    // For very large images, process in chunks to avoid memory issues
    if (width * height > 4000000) { // 4MP threshold
      this.updateProgress({ progress: 0.3, stage: 'processing', message: 'Processing large image in chunks...' });
      
      // Create a new canvas for the result
      const resultCanvas = document.createElement('canvas');
      resultCanvas.width = width;
      resultCanvas.height = height;
      const resultCtx = resultCanvas.getContext('2d')!;
      
      // Process in chunks
      const chunksX = Math.ceil(width / chunkSize);
      const chunksY = Math.ceil(height / chunkSize);
      const totalChunks = chunksX * chunksY;
      let processedChunks = 0;
      
      for (let y = 0; y < chunksY; y++) {
        for (let x = 0; x < chunksX; x++) {
          const chunkX = x * chunkSize;
          const chunkY = y * chunkSize;
          const chunkWidth = Math.min(chunkSize, width - chunkX);
          const chunkHeight = Math.min(chunkSize, height - chunkY);
          
          // Extract chunk
          const chunkCanvas = document.createElement('canvas');
          chunkCanvas.width = chunkWidth;
          chunkCanvas.height = chunkHeight;
          const chunkCtx = chunkCanvas.getContext('2d')!;
          
          const imageData = ctx.getImageData(chunkX, chunkY, chunkWidth, chunkHeight);
          chunkCtx.putImageData(imageData, 0, 0);
          
          // Process chunk with upscaler
          const chunkDataUrl = chunkCanvas.toDataURL();
          const upscaledChunk = await this.upscaler!.upscale(chunkDataUrl);
          
          // Draw processed chunk back to result canvas
          const chunkImg = new Image();
          await new Promise((resolve) => {
            chunkImg.onload = resolve as any;
            chunkImg.src = upscaledChunk as string;
          });
          
          resultCtx.drawImage(chunkImg, chunkX * 4, chunkY * 4); // 4x scale
          
          processedChunks++;
          const progress = 0.3 + (processedChunks / totalChunks) * 0.5;
          this.updateProgress({ 
            progress, 
            stage: 'processing', 
            message: `Processing chunk ${processedChunks}/${totalChunks}...` 
          });
          
          // Add small delay to prevent blocking
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      return resultCanvas.toDataURL('image/png', 0.95);
    }
    
    // For smaller images, process normally
    const dataUrl = canvas.toDataURL();
    return await this.upscaler!.upscale(dataUrl);
  }

  /**
   * Converts dimensions from the specified unit to pixels
   * @param value The dimension value
   * @param unit The unit of measurement ('px', 'in', or 'cm')
   * @param dpi The DPI to use for conversion (only relevant for 'in' and 'cm')
   * @returns The dimension in pixels
   */
  private convertToPixels(value: number | undefined, unit: DimensionUnit = 'px', dpi: number = 300): number | undefined {
    if (value === undefined) return undefined;
    
    switch (unit) {
      case 'px': return value;
      case 'in': return Math.round(value * dpi);
      case 'cm': return Math.round((value / 2.54) * dpi);
      default: return value;
    }
  }

  /**
   * Validates canvas dimensions to prevent browser limitations
   * @param width Canvas width in pixels
   * @param height Canvas height in pixels
   * @returns Object with validation result and suggested limits
   */
  private validateCanvasSize(width: number, height: number): { isValid: boolean; maxWidth?: number; maxHeight?: number; error?: string } {
    // Most browsers have a canvas size limit around 32,767 pixels per dimension
    // and a total pixel limit around 268,435,456 pixels (16384 x 16384)
    const MAX_DIMENSION = 32767;
    const MAX_TOTAL_PIXELS = 268435456; // 16384 x 16384
    
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      return {
        isValid: false,
        maxWidth: MAX_DIMENSION,
        maxHeight: MAX_DIMENSION,
        error: `Canvas dimension too large. Maximum dimension is ${MAX_DIMENSION}px. Requested: ${width}x${height}px`
      };
    }
    
    const totalPixels = width * height;
    if (totalPixels > MAX_TOTAL_PIXELS) {
      // Calculate maximum dimensions while maintaining aspect ratio
      const aspectRatio = width / height;
      const maxWidth = Math.floor(Math.sqrt(MAX_TOTAL_PIXELS * aspectRatio));
      const maxHeight = Math.floor(MAX_TOTAL_PIXELS / maxWidth);
      
      return {
        isValid: false,
        maxWidth,
        maxHeight,
        error: `Canvas area too large. Maximum total pixels: ${MAX_TOTAL_PIXELS.toLocaleString()}. Requested: ${totalPixels.toLocaleString()} pixels (${width}x${height}px)`
      };
    }
    
    return { isValid: true };
  }

  private async processImageForPrint(
    imageData: string | HTMLImageElement | ImageData,
    options: UpscaleOptions = {}
  ): Promise<string> {
    const {
      targetDPI = 300,
      quality = 0.95,
      outputFormat = 'png',
      maxFileSize = 50,
      outputWidth,
      outputHeight,
      dimensionUnit = 'px',
      preserveAspectRatio = true,
    } = options;
    
    // Convert dimensions to pixels based on unit
    const outputWidthPx = this.convertToPixels(outputWidth, dimensionUnit, targetDPI);
    const outputHeightPx = this.convertToPixels(outputHeight, dimensionUnit, targetDPI);

    try {
      this.updateProgress({ progress: 0, stage: 'loading', message: 'Loading image...' });

      // Load image to get dimensions and calculate DPI requirements
      let img: HTMLImageElement;
      if (typeof imageData === 'string') {
        img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve as any;
          img.onerror = reject as any;
          img.src = imageData;
        });
      } else if (imageData instanceof HTMLImageElement) {
        img = imageData;
      } else {
        throw new Error('Unsupported image format');
      }

      this.updateProgress({ progress: 20, stage: 'processing', message: 'Analyzing image...' });

      // Assume 72 DPI as default for web images if not specified
      const currentDPI = 72;
      const dpiScale = this.calculateDPIScale(currentDPI, targetDPI);
      
      // Calculate required upscaling
      const requiredScale = Math.max(dpiScale, 1);
      
      this.updateProgress({ progress: 40, stage: 'processing', message: 'Upscaling image...' });

      // Create canvas for processing
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Check if we need chunked processing for large images
      const pixelCount = canvas.width * canvas.height;
      let upscaledImage: string;
      
      if (pixelCount > 4000000) { // 4MP threshold for chunking
        upscaledImage = await this.processImageInChunks(canvas);
      } else {
        // Use upscaler for AI-based enhancement on smaller images
        upscaledImage = await this.upscaler!.upscale(img, {
          output: 'base64',
          patchSize: 64, // Smaller patches for better memory management
          padding: 2,
          progress: (progress: number) => {
            this.updateProgress({ 
              progress: 40 + (progress * 0.5), 
              stage: 'processing', 
              message: `Upscaling... ${Math.round(progress * 100)}%` 
            });
          }
        });
      }

      this.updateProgress({ progress: 90, stage: 'processing', message: 'Finalizing...' });

      // If explicit output dimensions are provided, they take precedence over DPI scaling
      if (typeof outputWidthPx === 'number' || typeof outputHeightPx === 'number') {
        const baseImg = new Image();
        await new Promise((resolve) => {
          baseImg.onload = resolve as any;
          baseImg.src = upscaledImage as string;
        });

        const originalAspect = img.width / img.height;
        let targetW = outputWidthPx;
        let targetH = outputHeightPx;

        if (typeof targetW === 'number' && typeof targetH === 'number') {
          // both provided: use as-is (may change aspect ratio)
        } else if (typeof targetW === 'number') {
          targetH = preserveAspectRatio ? Math.round(targetW / originalAspect) : baseImg.height;
        } else if (typeof targetH === 'number') {
          targetW = preserveAspectRatio ? Math.round(targetH * originalAspect) : baseImg.width;
        } else {
          // Fallback should never happen due to guard above
          targetW = baseImg.width;
          targetH = baseImg.height;
        }

        // Validate canvas dimensions before creation
        const validation = this.validateCanvasSize(targetW!, targetH!);
        if (!validation.isValid) {
          const errorMsg = `${validation.error}\n\nSuggested maximum dimensions: ${validation.maxWidth}x${validation.maxHeight}px`;
          this.updateProgress({ progress: 0, stage: 'error', message: errorMsg });
          throw new Error(errorMsg);
        }

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = targetW!;
        finalCanvas.height = targetH!;
        const finalCtx = finalCanvas.getContext('2d');
        
        // Check if canvas context creation failed (another sign of size limits)
        if (!finalCtx) {
          const errorMsg = `Failed to create canvas context for ${targetW}x${targetH}px. Canvas may be too large for this browser.`;
          this.updateProgress({ progress: 0, stage: 'error', message: errorMsg });
          throw new Error(errorMsg);
        }
        
        finalCtx.imageSmoothingEnabled = true;
        finalCtx.imageSmoothingQuality = 'high';
        finalCtx.drawImage(baseImg, 0, 0, finalCanvas.width, finalCanvas.height);

        const finalResult = finalCanvas.toDataURL(`image/${outputFormat}`, quality);
        
        // Check if the result is valid (not empty)
        if (!finalResult || finalResult === 'data:,') {
          const errorMsg = `Canvas rendering failed for ${targetW}x${targetH}px. The image may be too large. Try reducing the dimensions.`;
          this.updateProgress({ progress: 0, stage: 'error', message: errorMsg });
          throw new Error(errorMsg);
        }
        
        this.updateProgress({ progress: 100, stage: 'complete', message: 'Image resized to target dimensions.' });
        return finalResult;
      }

      // If we need additional scaling for DPI, apply it
      if (dpiScale > 4) {
        // Apply additional scaling using canvas for extreme DPI requirements
        const tempImg = new Image();
        await new Promise((resolve) => {
          tempImg.onload = resolve as any;
          tempImg.src = upscaledImage as string;
        });

        const additionalScale = dpiScale / 4;
        const scaledWidth = Math.round(tempImg.width * additionalScale);
        const scaledHeight = Math.round(tempImg.height * additionalScale);
        
        // Validate canvas dimensions for DPI scaling
        const validation = this.validateCanvasSize(scaledWidth, scaledHeight);
        if (!validation.isValid) {
          const errorMsg = `${validation.error}\n\nSuggested maximum dimensions: ${validation.maxWidth}x${validation.maxHeight}px\nConsider reducing the DPI or image size.`;
          this.updateProgress({ progress: 0, stage: 'error', message: errorMsg });
          throw new Error(errorMsg);
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          const errorMsg = `Failed to create canvas context for DPI scaling (${scaledWidth}x${scaledHeight}px). Canvas may be too large.`;
          this.updateProgress({ progress: 0, stage: 'error', message: errorMsg });
          throw new Error(errorMsg);
        }
        
        // Use high-quality scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tempImg, 0, 0, canvas.width, canvas.height);
        
        const finalResult = canvas.toDataURL(`image/${outputFormat}`, quality);
        
        // Validate the result
        if (!finalResult || finalResult === 'data:,') {
          const errorMsg = `DPI scaling failed for ${scaledWidth}x${scaledHeight}px. The image may be too large. Try reducing the DPI or dimensions.`;
          this.updateProgress({ progress: 0, stage: 'error', message: errorMsg });
          throw new Error(errorMsg);
        }
        
        this.updateProgress({ progress: 100, stage: 'complete', message: 'Image upscaled successfully!' });
        return finalResult;
      }

      this.updateProgress({ progress: 100, stage: 'complete', message: 'Image upscaled successfully!' });
      return upscaledImage as string;

    } catch (error) {
      this.updateProgress({ 
        progress: 0, 
        stage: 'error', 
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
      throw error;
    }
  }

  async upscaleForPrint(
    file: File,
    options: UpscaleOptions = {}
  ): Promise<string> {
    const { maxFileSize = 50 } = options;
    
    // Validate file size
    if (!this.isFileSizeSupported(file, maxFileSize)) {
      throw new Error(`File size exceeds ${maxFileSize}MB limit. Please use a smaller image or increase the limit.`);
    }
    
    return this.processWithMemoryManagement(async () => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = async (e) => {
          try {
            const imageData = e.target?.result as string;
            const result = await this.processImageForPrint(imageData, options);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
    });
  }

  // Utility method to estimate output file size
  estimateOutputSize(inputFile: File, targetDPI: number = 300, options?: UpscaleOptions): number {
    const currentDPI = 72; // Assume web standard
    const scale = this.calculateDPIScale(currentDPI, targetDPI);
    let scaleFactor = Math.max(scale, 4); // Minimum 4x from AI upscaling
    
    // If dimensions are specified, factor them into the estimate
    if (options?.outputWidth || options?.outputHeight) {
      const dimensionUnit = options?.dimensionUnit || 'px';
      const outputWidthPx = this.convertToPixels(options?.outputWidth, dimensionUnit, targetDPI);
      const outputHeightPx = this.convertToPixels(options?.outputHeight, dimensionUnit, targetDPI);
      
      // If we have explicit dimensions, use them for a more accurate estimate
      if (outputWidthPx && outputHeightPx) {
        // Get a rough estimate of original dimensions
        const img = new Image();
        // We can't actually load the image here, so we'll make a rough estimate
        // based on the file size and assuming average compression
        const avgPixelBytes = 0.1; // Very rough estimate for compressed images
        const estimatedPixels = inputFile.size / avgPixelBytes;
        const estimatedSideLength = Math.sqrt(estimatedPixels);
        
        // Calculate area ratio for scaling
        const originalArea = estimatedSideLength * estimatedSideLength;
        const newArea = outputWidthPx * outputHeightPx;
        scaleFactor = Math.sqrt(newArea / originalArea);
      }
    }
    
    // Rough estimation: scale^2 for area increase
    return inputFile.size * Math.pow(scaleFactor, 2);
  }

  // Check if file is too large for processing
  isFileSizeSupported(file: File, maxSizeMB: number = 50): boolean {
    return file.size <= maxSizeMB * 1024 * 1024;
  }

  /**
   * Splits an image into parts based on real dimensions and upscales each part to target DPI
   * @param file The input image file
   * @param options Split and upscale options
   * @returns Promise resolving to split upscale result with all parts
   */
  async splitAndUpscaleImage(
    file: File,
    options: SplitUpscaleOptions
  ): Promise<SplitUpscaleResult> {
    const {
      realWidthInches,
      realHeightInches,
      rollPartWidthInches,
      targetDPI = 300,
      outputFormat = 'png',
      quality = 0.95
    } = options;

    // Validate inputs
    if (realWidthInches <= 0 || realHeightInches <= 0 || rollPartWidthInches <= 0) {
      throw new Error('All dimensions must be positive numbers');
    }

    if (rollPartWidthInches > realWidthInches) {
      throw new Error('Roll part width cannot be larger than total image width');
    }

    // Calculate number of parts
    const totalParts = Math.ceil(realWidthInches / rollPartWidthInches);
    
    this.updateProgress({ 
      progress: 0, 
      stage: 'starting', 
      message: `Preparing to split image into ${totalParts} parts...` 
    });

    return this.processWithMemoryManagement(async () => {
      // Load the original image
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve as any;
        img.onerror = reject as any;
        img.src = imageData;
      });

      this.updateProgress({ 
        progress: 10, 
        stage: 'analyzing', 
        message: 'Analyzing image dimensions...' 
      });

      // Calculate pixel dimensions for each part at target DPI
      const partWidthPx = Math.round(rollPartWidthInches * targetDPI);
      const partHeightPx = Math.round(realHeightInches * targetDPI);
      
      // Calculate the scale factor from original image to target dimensions
      const originalWidthPx = img.width;
      const originalHeightPx = img.height;
      
      // Calculate how many pixels in the original image correspond to each part
      const pixelsPerInchOriginalWidth = originalWidthPx / realWidthInches;
      const pixelsPerInchOriginalHeight = originalHeightPx / realHeightInches;
      
      const partWidthInOriginal = Math.round(rollPartWidthInches * pixelsPerInchOriginalWidth);
      const partHeightInOriginal = originalHeightPx; // Full height for each part

      this.updateProgress({ 
        progress: 20, 
        stage: 'chunking', 
        message: `Splitting into ${totalParts} parts...` 
      });

      const parts: string[] = [];
      
      // Create canvas for extracting parts
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = img.width;
      sourceCanvas.height = img.height;
      const sourceCtx = sourceCanvas.getContext('2d')!;
      sourceCtx.drawImage(img, 0, 0);

      // Process each part
      for (let i = 0; i < totalParts; i++) {
        const startX = i * partWidthInOriginal;
        const actualPartWidth = Math.min(partWidthInOriginal, originalWidthPx - startX);
        
        this.updateProgress({ 
          progress: 20 + (i / totalParts) * 60, 
          stage: 'upscaling', 
          message: `Processing part ${i + 1} of ${totalParts}...` 
        });

        // Extract the part from original image
        const partCanvas = document.createElement('canvas');
        partCanvas.width = actualPartWidth;
        partCanvas.height = partHeightInOriginal;
        const partCtx = partCanvas.getContext('2d')!;
        
        partCtx.drawImage(
          img,
          startX, 0, actualPartWidth, partHeightInOriginal,
          0, 0, actualPartWidth, partHeightInOriginal
        );

        // Convert part to data URL for upscaling
        const partDataUrl = partCanvas.toDataURL();
        
        // Upscale the part using the existing upscaler
        let upscaledPart: string;
        
        // Check if we need AI upscaling or just resizing
        const scaleFactorWidth = partWidthPx / actualPartWidth;
        const scaleFactorHeight = partHeightPx / partHeightInOriginal;
        const maxScaleFactor = Math.max(scaleFactorWidth, scaleFactorHeight);
        
        if (maxScaleFactor > 1.5) {
          // Use AI upscaling for significant enlargement
          upscaledPart = await this.upscaler!.upscale(partDataUrl) as string;
          
          // If we need additional scaling after AI upscaling, apply it
          if (maxScaleFactor > 4) {
            const tempImg = new Image();
            await new Promise((resolve) => {
              tempImg.onload = resolve as any;
              tempImg.src = upscaledPart;
            });
            
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = partWidthPx;
            finalCanvas.height = partHeightPx;
            const finalCtx = finalCanvas.getContext('2d')!;
            finalCtx.imageSmoothingEnabled = true;
            finalCtx.imageSmoothingQuality = 'high';
            finalCtx.drawImage(tempImg, 0, 0, partWidthPx, partHeightPx);
            
            upscaledPart = finalCanvas.toDataURL(`image/${outputFormat}`, quality);
          }
        } else {
          // Use high-quality canvas scaling for smaller enlargements
          const scaledCanvas = document.createElement('canvas');
          scaledCanvas.width = partWidthPx;
          scaledCanvas.height = partHeightPx;
          const scaledCtx = scaledCanvas.getContext('2d')!;
          scaledCtx.imageSmoothingEnabled = true;
          scaledCtx.imageSmoothingQuality = 'high';
          
          const partImg = new Image();
          await new Promise((resolve) => {
            partImg.onload = resolve as any;
            partImg.src = partDataUrl;
          });
          
          scaledCtx.drawImage(partImg, 0, 0, partWidthPx, partHeightPx);
          upscaledPart = scaledCanvas.toDataURL(`image/${outputFormat}`, quality);
        }
        
        parts.push(upscaledPart);
        
        // Small delay to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      this.updateProgress({ 
        progress: 100, 
        stage: 'complete', 
        message: `Successfully created ${totalParts} upscaled parts!` 
      });

      return {
        parts,
        totalParts,
        partDimensions: {
          widthPx: partWidthPx,
          heightPx: partHeightPx
        },
        metadata: {
          originalRealWidth: realWidthInches,
          originalRealHeight: realHeightInches,
          rollPartWidth: rollPartWidthInches,
          targetDPI
        }
      };
    });
  }
}

// Export singleton instance
export const imageUpscaler = new ImageUpscalerService();
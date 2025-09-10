'use client';

import React, { useState, useCallback, useRef } from 'react';
import { imageUpscaler, UpscaleProgress, UpscaleOptions, SplitUpscaleOptions, SplitUpscaleResult } from '@/lib/imageUpscaler';

interface ImageUploaderProps {
  onUpscaleComplete?: (result: string) => void;
  onError?: (error: string) => void;
}

export default function ImageUploader({ onUpscaleComplete, onError }: ImageUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<UpscaleProgress | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [useBackend, setUseBackend] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [options, setOptions] = useState<UpscaleOptions>({
    targetDPI: 300,
    quality: 0.95,
    outputFormat: 'png',
    // New sizing defaults (undefined means not forced)
    outputWidth: undefined,
    outputHeight: undefined,
    dimensionUnit: 'px',
    preserveAspectRatio: true,
  });
  
  // Split upscale state
  const [useSplitUpscale, setUseSplitUpscale] = useState(false);
  const [splitOptions, setSplitOptions] = useState<SplitUpscaleOptions>({
    realWidthInches: 200,
    realHeightInches: 100,
    rollPartWidthInches: 20,
    targetDPI: 300,
    outputFormat: 'png',
    quality: 0.95
  });
  const [splitResult, setSplitResult] = useState<SplitUpscaleResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(file => file.type.startsWith('image/'));
    
    if (imageFile) {
      handleFileSelect(imageFile);
    } else {
      onError?.('Please drop a valid image file');
    }
  }, [onError]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      onError?.('Please select a valid image file');
      return;
    }

    // Check file size (50MB limit)
    if (!imageUpscaler.isFileSizeSupported(file, 50)) {
      onError?.('File size too large. Please select a file smaller than 50MB');
      return;
    }

    setSelectedFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, [onError]);

  // Backend processing functions
  const processWithBackend = async (useChunked: boolean = false) => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('image', selectedFile);
    formData.append('options', JSON.stringify(options));

    try {
      const endpoint = useChunked ? '/api/upscale/chunked' : '/api/upscale';
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Processing failed');
      }

      if (useChunked) {
        // Handle chunked processing with job tracking
        const data = await response.json();
        setJobId(data.jobId);
        setProgress({ progress: 0, stage: 'starting', message: 'Processing started...' });
        
        // Poll for progress
        pollProgress(data.jobId);
      } else {
        // Handle direct processing
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        setProcessedImage(imageUrl);
        setProgress({ progress: 100, stage: 'complete', message: 'Image processed successfully!' });
      }
    } catch (err) {
      console.error('Backend processing failed:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
      setProgress({ progress: 0, stage: 'error', message: 'Processing failed' });
    }
  };

  const pollProgress = async (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/upscale/progress?jobId=${jobId}`);
        if (!response.ok) {
          throw new Error('Failed to get progress');
        }

        const data = await response.json();
        setProgress({ progress: data.progress, stage: data.stage, message: data.message });

        if (data.status === 'completed') {
          clearInterval(pollInterval);
          if (data.result) {
            const imageUrl = `data:image/${options.outputFormat || 'jpeg'};base64,${data.result}`;
            setProcessedImage(imageUrl);
          }
          // Clean up job
          await fetch(`/api/upscale/progress?jobId=${jobId}`, { method: 'DELETE' });
        } else if (data.status === 'error') {
          clearInterval(pollInterval);
          setError(data.error || 'Processing failed');
          setProgress({ progress: 0, stage: 'error', message: data.error || 'Processing failed' });
        }
      } catch (_err) {
        clearInterval(pollInterval);
        setError('Failed to track progress');
        setProgress({ progress: 0, stage: 'error', message: 'Failed to track progress' });
      }
    }, 1000);
  };

  const handleSplitUpscale = useCallback(async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setProgress({ progress: 0, stage: 'starting' });
    setSplitResult(null);
    setError(null);

    try {
      imageUpscaler.setProgressCallback(setProgress);
      const result = await imageUpscaler.splitAndUpscaleImage(selectedFile, splitOptions);
      setSplitResult(result);
      setProgress({ progress: 100, stage: 'complete', message: `Successfully created ${result.totalParts} upscaled parts!` });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setError(errorMessage);
      setProgress({ progress: 0, stage: 'error', message: errorMessage });
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, splitOptions]);

  const handleUpscale = useCallback(async () => {
    if (!selectedFile) return;

    if (useSplitUpscale) {
      await handleSplitUpscale();
      return;
    }

    setIsProcessing(true);
    setProgress({ progress: 0, stage: 'loading' });
    setProcessedImage(null);
    setError(null);
    setJobId(null);

    try {
      if (useBackend) {
        // Determine if we need chunked processing for very large outputs
        const outputWidthPx = options.outputWidth ? 
          (options.dimensionUnit === 'in' ? options.outputWidth * (options.targetDPI || 300) :
           options.dimensionUnit === 'cm' ? options.outputWidth * (options.targetDPI || 300) / 2.54 :
           options.outputWidth) : 0;
        const outputHeightPx = options.outputHeight ? 
          (options.dimensionUnit === 'in' ? options.outputHeight * (options.targetDPI || 300) :
           options.dimensionUnit === 'cm' ? options.outputHeight * (options.targetDPI || 300) / 2.54 :
           options.outputHeight) : 0;
        
        const needsChunking = (outputWidthPx > 20000 || outputHeightPx > 20000 || 
                              (outputWidthPx * outputHeightPx) > 100000000);
        
        await processWithBackend(needsChunking);
      } else {
        // Fallback to client-side processing
        imageUpscaler.setProgressCallback(setProgress);
        const result = await imageUpscaler.upscaleForPrint(selectedFile, options);
        onUpscaleComplete?.(result);
        setProgress({ progress: 100, stage: 'complete', message: 'Upscaling completed!' });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      onError?.(errorMessage);
      setProgress({ progress: 0, stage: 'error', message: errorMessage });
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, options, onUpscaleComplete, onError, useBackend, useSplitUpscale, handleSplitUpscale]);

  const resetUploader = useCallback(() => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setProgress(null);
    setIsProcessing(false);
    setSplitResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const estimatedSize = selectedFile ? imageUpscaler.estimateOutputSize(selectedFile, options.targetDPI, options) : 0;
  const estimatedSizeMB = (estimatedSize / (1024 * 1024)).toFixed(1);

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      {/* Upload Area */}
      <div
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-200
          ${isDragOver 
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
          }
          ${selectedFile ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          className="hidden"
        />
        
        {!selectedFile ? (
          <div className="space-y-4">
            <div className="text-6xl text-gray-400">
              📸
            </div>
            <div>
              <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
                Drop your image here or click to browse
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Supports JPG, PNG, WebP • Max 50MB
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-4xl text-green-500">✓</div>
            <div>
              <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
                {selectedFile.name}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Preview and Options */}
      {selectedFile && previewUrl && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Preview */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Preview</h3>
            <div className="border rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800">
              <img
                src={previewUrl}
                alt="Preview"
                className="w-full h-64 object-contain"
              />
            </div>
          </div>

          {/* Options */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Upscale Settings</h3>
            
            {/* Mode Selection */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Processing Mode
              </label>
              <div className="space-y-2">
                <label className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name="upscaleMode"
                    checked={!useSplitUpscale}
                    onChange={() => setUseSplitUpscale(false)}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Regular Upscale - Single output image
                  </span>
                </label>
                <label className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name="upscaleMode"
                    checked={useSplitUpscale}
                    onChange={() => setUseSplitUpscale(true)}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Split Upscale - Multiple parts for large prints
                  </span>
                </label>
              </div>
            </div>
             
             {/* Split Upscale Options */}
             {useSplitUpscale && (
               <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                 <h4 className="text-md font-medium text-blue-800 dark:text-blue-200">Split Upscale Settings</h4>
                 
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                   <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                       Real Width (inches)
                     </label>
                     <input
                       type="number"
                       min="1"
                       step="0.1"
                       value={splitOptions.realWidthInches}
                       onChange={(e) => setSplitOptions(prev => ({ ...prev, realWidthInches: Number(e.target.value) }))}
                       placeholder="e.g. 200"
                       className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                     />
                   </div>
                   <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                       Real Height (inches)
                     </label>
                     <input
                       type="number"
                       min="1"
                       step="0.1"
                       value={splitOptions.realHeightInches}
                       onChange={(e) => setSplitOptions(prev => ({ ...prev, realHeightInches: Number(e.target.value) }))}
                       placeholder="e.g. 100"
                       className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                     />
                   </div>
                   <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                       Roll Part Width (inches)
                     </label>
                     <input
                       type="number"
                       min="1"
                       step="0.1"
                       value={splitOptions.rollPartWidthInches}
                       onChange={(e) => setSplitOptions(prev => ({ ...prev, rollPartWidthInches: Number(e.target.value) }))}
                       placeholder="e.g. 20"
                       className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                     />
                   </div>
                 </div>
                 
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                       Target DPI
                     </label>
                     <select
                       value={splitOptions.targetDPI}
                       onChange={(e) => setSplitOptions(prev => ({ ...prev, targetDPI: Number(e.target.value) }))}
                       className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                     >
                       <option value={150}>150 DPI (Draft)</option>
                       <option value={300}>300 DPI (Standard Print)</option>
                       <option value={600}>600 DPI (High Quality)</option>
                       <option value={1200}>1200 DPI (Professional)</option>
                     </select>
                   </div>
                   <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                       Output Format
                     </label>
                     <select
                       value={splitOptions.outputFormat}
                       onChange={(e) => setSplitOptions(prev => ({ ...prev, outputFormat: e.target.value as 'png' | 'jpeg' | 'webp' }))}
                       className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                     >
                       <option value="png">PNG (Recommended)</option>
                       <option value="jpeg">JPEG</option>
                       <option value="webp">WebP</option>
                     </select>
                   </div>
                 </div>
                 
                 <div className="p-3 bg-blue-100 dark:bg-blue-800/30 rounded-md">
                   <p className="text-sm text-blue-800 dark:text-blue-200">
                     <strong>Output:</strong> {Math.ceil(splitOptions.realWidthInches / splitOptions.rollPartWidthInches)} parts, 
                     each {splitOptions.rollPartWidthInches}&quot; × {splitOptions.realHeightInches}&quot; at {splitOptions.targetDPI} DPI
                     <br />
                     <strong>Part dimensions:</strong> {Math.round(splitOptions.rollPartWidthInches * (splitOptions.targetDPI || 300))} × {Math.round(splitOptions.realHeightInches * (splitOptions.targetDPI || 300))} pixels
                   </p>
                 </div>
               </div>
             )}
             
             {/* Regular Upscale Options */}
             {!useSplitUpscale && (
             <div className="space-y-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                   Target DPI (Print Quality)
                 </label>
                <select
                  value={options.targetDPI}
                  onChange={(e) => setOptions(prev => ({ ...prev, targetDPI: Number(e.target.value) }))}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value={150}>150 DPI (Draft)</option>
                  <option value={300}>300 DPI (Standard Print)</option>
                  <option value={600}>600 DPI (High Quality)</option>
                  <option value={1200}>1200 DPI (Professional)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Output Format</label>
                <select
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  value={options.outputFormat}
                  onChange={(e) => setOptions(prev => ({ ...prev, outputFormat: e.target.value as 'png' | 'jpeg' | 'webp' }))}
                >
                  <option value="png">PNG (Recommended)</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </div>

              {/* Processing Mode Toggle */}
              <div>
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={useBackend}
                    onChange={(e) => setUseBackend(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Use server-side processing (recommended for large images)
                  </span>
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {useBackend 
                    ? "Server processing can handle very large images (up to 200x200 inches) with chunked processing."
                    : "Browser processing is limited by memory and canvas size restrictions."}
                </p>
              </div>

              {/* Output Dimensions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Output Dimensions
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Width</label>
                    <input
                      type="number"
                      min={0.1}
                      step={options.dimensionUnit === 'px' ? 1 : 0.1}
                      value={typeof options.outputWidth === 'number' ? options.outputWidth : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOptions(prev => ({
                          ...prev,
                          outputWidth: v === '' ? undefined : Number(v),
                        }));
                      }}
                      placeholder={options.dimensionUnit === 'px' ? "e.g. 3000" : options.dimensionUnit === 'in' ? "e.g. 10" : "e.g. 25.4"}
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Height</label>
                    <input
                      type="number"
                      min={0.1}
                      step={options.dimensionUnit === 'px' ? 1 : 0.1}
                      value={typeof options.outputHeight === 'number' ? options.outputHeight : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOptions(prev => ({
                          ...prev,
                          outputHeight: v === '' ? undefined : Number(v),
                        }));
                      }}
                      placeholder={options.dimensionUnit === 'px' ? "e.g. 2000" : options.dimensionUnit === 'in' ? "e.g. 8" : "e.g. 20.3"}
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Unit</label>
                    <select
                      value={options.dimensionUnit}
                      onChange={(e) => setOptions(prev => ({ ...prev, dimensionUnit: e.target.value as 'px' | 'in' | 'cm' }))}
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="px">Pixels (px)</option>
                      <option value="in">Inches (in)</option>
                      <option value="cm">Centimeters (cm)</option>
                    </select>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="preserve-aspect"
                    type="checkbox"
                    checked={options.preserveAspectRatio !== false}
                    onChange={(e) => setOptions(prev => ({ ...prev, preserveAspectRatio: e.target.checked }))}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <label htmlFor="preserve-aspect" className="text-sm text-gray-700 dark:text-gray-300">
                    Preserve aspect ratio when only one dimension is set
                  </label>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Tips: 
                  <br />• Leave one field empty to auto-calculate the other when preserving aspect ratio
                  <br />• For print-quality output, use inches or centimeters with your desired DPI
                  <br />• Large dimensions (even over 200 inches) are supported but may require more processing time
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Quality: {Math.round((options.quality || 0.95) * 100)}%
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="1"
                  step="0.05"
                  value={options.quality}
                  onChange={(e) => setOptions(prev => ({ ...prev, quality: Number(e.target.value) }))}
                  className="w-full"
                />
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>Estimated output size:</strong> ~{estimatedSizeMB} MB
                </p>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {/* Split Result Display */}
      {splitResult && (
        <div className="mt-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Split Upscale Results ({splitResult.totalParts} parts)
          </h3>
          
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p><strong>Original dimensions:</strong> {splitResult.metadata.originalRealWidth}&quot; × {splitResult.metadata.originalRealHeight}&quot;</p>
                <p><strong>Roll part width:</strong> {splitResult.metadata.rollPartWidth}&quot;</p>
              </div>
              <div>
                <p><strong>Target DPI:</strong> {splitResult.metadata.targetDPI}</p>
                <p><strong>Part dimensions:</strong> {splitResult.partDimensions.widthPx} × {splitResult.partDimensions.heightPx} pixels</p>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {splitResult.parts.map((part, index) => (
              <div key={index} className="space-y-2">
                <div className="border rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800">
                  <img
                    src={part}
                    alt={`Part ${index + 1}`}
                    className="w-full h-32 object-contain"
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Part {index + 1}
                  </span>
                  <a
                    href={part}
                    download={`part-${index + 1}.${splitResult.metadata.targetDPI}dpi.png`}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors"
                  >
                    Download
                  </a>
                </div>
              </div>
            ))}
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => {
                splitResult.parts.forEach((part, index) => {
                  const link = document.createElement('a');
                  link.href = part;
                  link.download = `part-${index + 1}.${splitResult.metadata.targetDPI}dpi.png`;
                  link.click();
                });
              }}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Download All Parts
            </button>
          </div>
        </div>
      )}

      {/* Enhanced Progress Display */}
      {progress && (
        <div className="mt-6 space-y-4">
          {/* Main Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {progress.stage === 'complete' ? 'Complete!' : 
                 progress.stage === 'error' ? 'Error' :
                 progress.stage === 'loading' ? 'Loading model...' :
                 progress.stage === 'upscaling' ? 'AI Upscaling...' :
                 progress.stage === 'resizing' ? 'Resizing...' :
                 progress.stage === 'starting' ? 'Starting...' :
                 progress.stage === 'analyzing' ? 'Analyzing image...' :
                 progress.stage === 'chunking' ? 'Preparing chunks...' :
                 progress.stage === 'processing' ? 'Processing chunks...' :
                 progress.stage === 'compositing' ? 'Combining results...' :
                 progress.message || 'Processing...'}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {Math.round(progress.progress)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all duration-300 ${
                  progress.stage === 'error' ? 'bg-red-500' : 
                  progress.stage === 'complete' ? 'bg-green-500' : 'bg-blue-500'
                }`}
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            {progress.message && (
              <p className="text-sm text-gray-600 dark:text-gray-400">{progress.message}</p>
            )}
            {jobId && useBackend && (
              <p className="text-xs text-blue-600 dark:text-blue-400">Job ID: {jobId}</p>
            )}
          </div>

          {/* Stage Indicator */}
          <div className="flex items-center justify-center space-x-4 text-xs">
            <div className={`flex items-center space-x-1 ${
              progress.stage === 'loading' || progress.stage === 'starting' ? 'text-blue-600 dark:text-blue-400' : 
              progress.progress > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                progress.stage === 'loading' || progress.stage === 'starting' ? 'bg-blue-600 animate-pulse' : 
                progress.progress > 0 ? 'bg-green-600' : 'bg-gray-400'
              }`} />
              <span>Loading</span>
            </div>
            <div className={`flex items-center space-x-1 ${
              progress.stage === 'processing' || progress.stage === 'analyzing' || progress.stage === 'chunking' || progress.stage === 'upscaling' ? 'text-blue-600 dark:text-blue-400' : 
              progress.progress > 20 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                progress.stage === 'processing' || progress.stage === 'analyzing' || progress.stage === 'chunking' || progress.stage === 'upscaling' ? 'bg-blue-600 animate-pulse' : 
                progress.progress > 20 ? 'bg-green-600' : 'bg-gray-400'
              }`} />
              <span>AI Processing</span>
            </div>
            <div className={`flex items-center space-x-1 ${
              progress.stage === 'complete' ? 'text-green-600 dark:text-green-400' : 
              progress.progress >= 100 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                progress.stage === 'complete' ? 'bg-green-600' : 
                progress.progress >= 100 ? 'bg-green-600' : 'bg-gray-400'
              }`} />
              <span>Complete</span>
            </div>
          </div>

          {/* Large File Processing Info */}
          {selectedFile && selectedFile.size > 10 * 1024 * 1024 && progress.stage === 'processing' && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md border border-yellow-200 dark:border-yellow-800">
              <div className="flex items-start space-x-2">
                <div className="w-4 h-4 mt-0.5 text-yellow-600 dark:text-yellow-400">
                  ⚡
                </div>
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">
                    Large File Processing
                  </p>
                  <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                    Your image is being processed in chunks for optimal performance and memory usage.
                    {progress.message?.includes('chunk') && (
                      <span className="block mt-1 font-mono text-xs">
                        {progress.message}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {progress.stage === 'error' && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800">
              <div className="flex items-start space-x-2">
                <div className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400">
                  ❌
                </div>
                <div className="text-sm">
                  <p className="font-medium text-red-800 dark:text-red-200">
                    Processing Error
                  </p>
                  <p className="text-red-700 dark:text-red-300 mt-1">
                    {progress.message || 'An error occurred during processing'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {selectedFile && (
        <div className="mt-6 flex gap-4">
          <button
            onClick={handleUpscale}
            disabled={isProcessing}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-3 px-6 rounded-lg transition-colors duration-200"
          >
            {isProcessing ? 'Processing...' : useSplitUpscale ? 'Split & Upscale' : 'Upscale for Print'}
          </button>
          
          <button
            onClick={resetUploader}
            disabled={isProcessing}
            className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
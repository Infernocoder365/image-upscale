'use client';

import React, { useState, useRef } from 'react';

interface ResultDisplayProps {
  originalImage?: string;
  upscaledImage: string;
  onReset?: () => void;
}

export default function ResultDisplay({ originalImage, upscaledImage, onReset }: ResultDisplayProps) {
  const [showComparison, setShowComparison] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);

  const downloadImage = async (format: 'png' | 'jpeg' = 'png') => {
    setIsDownloading(true);
    
    try {
      // Convert base64 to blob
      const response = await fetch(upscaledImage);
      const blob = await response.blob();
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `upscaled-image-300dpi-${timestamp}.${format}`;
      
      if (downloadLinkRef.current) {
        downloadLinkRef.current.href = url;
        downloadLinkRef.current.download = filename;
        downloadLinkRef.current.click();
      }
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      // Convert base64 to blob
      const response = await fetch(upscaledImage);
      const blob = await response.blob();
      
      // Copy to clipboard
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      
      alert('Image copied to clipboard!');
    } catch (error) {
      console.error('Copy failed:', error);
      alert('Copy to clipboard failed. Please use download instead.');
    }
  };

  const getImageDimensions = (imageSrc: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.src = imageSrc;
    });
  };

  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  React.useEffect(() => {
    getImageDimensions(upscaledImage).then(setDimensions);
  }, [upscaledImage]);

  return (
    <div className="w-full max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
            Upscaling Complete! 🎉
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Your image has been enhanced to 300 DPI print quality
          </p>
          {dimensions && (
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
              Output dimensions: {dimensions.width} × {dimensions.height} pixels
            </p>
          )}
        </div>
        
        <button
          onClick={onReset}
          className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
        >
          ← Back to Upload
        </button>
      </div>

      {/* Toggle View */}
      <div className="flex justify-center mb-6">
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-1 flex">
          <button
            onClick={() => setShowComparison(true)}
            className={`px-4 py-2 rounded-md transition-colors ${
              showComparison
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            Compare
          </button>
          <button
            onClick={() => setShowComparison(false)}
            className={`px-4 py-2 rounded-md transition-colors ${
              !showComparison
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            Full View
          </button>
        </div>
      </div>

      {/* Image Display */}
      {showComparison && originalImage ? (
        /* Comparison View */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 text-center">
              Original (72 DPI)
            </h3>
            <div className="border rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800">
              <img
                src={originalImage}
                alt="Original"
                className="w-full h-96 object-contain"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 text-center">
              Enhanced (300 DPI)
            </h3>
            <div className="border rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800">
              <img
                src={upscaledImage}
                alt="Upscaled"
                className="w-full h-96 object-contain"
              />
            </div>
          </div>
        </div>
      ) : (
        /* Full View */
        <div className="mb-6">
          <div className="border rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800">
            <img
              src={upscaledImage}
              alt="Upscaled Result"
              className="w-full max-h-[70vh] object-contain"
            />
          </div>
        </div>
      )}

      {/* Quality Information */}
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
        <div className="flex items-start space-x-3">
          <div className="text-green-500 text-xl">✨</div>
          <div>
            <h4 className="font-semibold text-green-800 dark:text-green-200 mb-2">
              Print-Ready Quality Achieved
            </h4>
            <ul className="text-sm text-green-700 dark:text-green-300 space-y-1">
              <li>• Enhanced to 300 DPI for professional printing</li>
              <li>• AI-powered upscaling preserves and enhances details</li>
              <li>• Optimized for large format printing and high-quality reproduction</li>
              <li>• Compatible with professional printing services</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Download Options */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
          Download Options
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={() => downloadImage('png')}
            disabled={isDownloading}
            className="flex flex-col items-center p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <div className="text-2xl mb-2">🖼️</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">PNG</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Lossless</div>
          </button>
          
          <button
            onClick={() => downloadImage('jpeg')}
            disabled={isDownloading}
            className="flex flex-col items-center p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <div className="text-2xl mb-2">📷</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">JPEG</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Smaller</div>
          </button>
          
          <button
            onClick={copyToClipboard}
            className="flex flex-col items-center p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="text-2xl mb-2">📋</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Copy</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Clipboard</div>
          </button>
          
          <button
            onClick={() => {
              const printWindow = window.open('', '_blank');
              if (printWindow) {
                printWindow.document.write(`
                  <html>
                    <head><title>Print High-Quality Image</title></head>
                    <body style="margin:0;padding:20px;text-align:center;">
                      <img src="${upscaledImage}" style="max-width:100%;height:auto;" />
                    </body>
                  </html>
                `);
                printWindow.document.close();
                printWindow.print();
              }
            }}
            className="flex flex-col items-center p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="text-2xl mb-2">🖨️</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Print</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Direct</div>
          </button>
        </div>
        
        {isDownloading && (
          <div className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
            Preparing download...
          </div>
        )}
      </div>

      {/* Hidden download link */}
      <a ref={downloadLinkRef} className="hidden" />
    </div>
  );
}
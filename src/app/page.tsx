'use client';

import { useState } from 'react';
import ImageUploader from '@/components/ImageUploader';
import ResultDisplay from '@/components/ResultDisplay';

export default function Home() {
  const [upscaledImage, setUpscaledImage] = useState<string | null>(null);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpscaleComplete = (result: string) => {
    setUpscaledImage(result);
    setError(null);
  };

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
    setUpscaledImage(null);
  };

  const handleReset = () => {
    setUpscaledImage(null);
    setOriginalImage(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              AI Image Upscaler
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Transform your images to professional 300 DPI print quality using advanced AI technology. 
              Perfect for large format printing, professional photography, and high-quality reproduction.
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="text-red-500 text-xl">⚠️</div>
              <div>
                <h4 className="font-semibold text-red-800 dark:text-red-200">Error</h4>
                <p className="text-red-700 dark:text-red-300">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {!upscaledImage ? (
          <div>
            {/* Features Section */}
            <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="text-3xl mb-3">🎯</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  300 DPI Quality
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Professional print-ready resolution for magazines, posters, and high-quality prints.
                </p>
              </div>
              
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="text-3xl mb-3">🤖</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  AI Enhancement
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Advanced neural networks preserve and enhance details while upscaling your images.
                </p>
              </div>
              
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="text-3xl mb-3">⚡</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Large File Support
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Handle huge image files up to 50MB with optimized processing and memory management.
                </p>
              </div>
            </div>

            {/* Upload Component */}
            <ImageUploader
              onUpscaleComplete={handleUpscaleComplete}
              onError={handleError}
            />
          </div>
        ) : (
          <ResultDisplay
            originalImage={originalImage || undefined}
            upscaledImage={upscaledImage}
            onReset={handleReset}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Powered by{' '}
              <a 
                href="https://www.npmjs.com/package/upscaler" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                UpscalerJS
              </a>
              {' '}• Built with Next.js and AI technology
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

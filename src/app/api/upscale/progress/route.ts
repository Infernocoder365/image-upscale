import { NextRequest, NextResponse } from 'next/server';

// In-memory store for progress tracking
// In production, you'd use Redis or a database
const progressStore = new Map<string, {
  progress: number;
  stage: string;
  message: string;
  status: 'processing' | 'completed' | 'error';
  result?: string;
  error?: string;
}>();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  
  if (!jobId) {
    return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
  }
  
  const progress = progressStore.get(jobId);
  
  if (!progress) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  
  return NextResponse.json(progress);
}

export async function POST(request: NextRequest) {
  const { jobId, progress, stage, message, status, result, error } = await request.json();
  
  if (!jobId) {
    return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
  }
  
  progressStore.set(jobId, {
    progress: progress || 0,
    stage: stage || 'processing',
    message: message || '',
    status: status || 'processing',
    result,
    error
  });
  
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  
  if (!jobId) {
    return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
  }
  
  progressStore.delete(jobId);
  
  return NextResponse.json({ success: true });
}
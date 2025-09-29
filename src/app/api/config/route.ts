import { NextResponse } from 'next/server';

export async function GET() {
  const maxFileSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || '4');

  return NextResponse.json({
    maxFileSizeMB: maxFileSizeMB
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
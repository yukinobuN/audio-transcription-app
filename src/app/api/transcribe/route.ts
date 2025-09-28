import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio, getMimeType } from '@/lib/gemini';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: '音声ファイルが見つかりません' },
        { status: 400 }
      );
    }

    // ファイルサイズチェック（100MB）
    const maxSize = 100 * 1024 * 1024; // 100MB in bytes
    if (audioFile.size > maxSize) {
      return NextResponse.json(
        { error: 'ファイルサイズが100MBを超えています' },
        { status: 400 }
      );
    }

    // ファイル形式チェック
    const allowedExtensions = ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.webm'];
    const fileExtension = '.' + audioFile.name.toLowerCase().split('.').pop();

    if (!allowedExtensions.includes(fileExtension)) {
      return NextResponse.json(
        { error: '対応していないファイル形式です。MP3、M4A、WAV、FLAC、OGG、WebMファイルをお選びください。' },
        { status: 400 }
      );
    }

    // ファイルをBufferに変換
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // MIMEタイプを取得
    const mimeType = getMimeType(audioFile.name);

    console.log(`Processing audio file: ${audioFile.name}, size: ${audioFile.size} bytes, type: ${mimeType}`);

    // Gemini APIで音声をテキストに変換
    const transcriptionText = await transcribeAudio(buffer, mimeType);

    return NextResponse.json({
      text: transcriptionText,
      fileName: audioFile.name,
      fileSize: audioFile.size,
      processingTime: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Transcription API error:', error);

    // エラーメッセージの処理
    let errorMessage = '音声の変換中にエラーが発生しました';

    if (error instanceof Error) {
      // Gemini APIのエラーメッセージを含める
      if (error.message.includes('API key')) {
        errorMessage = 'Gemini APIキーが設定されていません';
      } else if (error.message.includes('quota')) {
        errorMessage = 'APIの利用制限に達しました。しばらく時間をおいてから再試行してください';
      } else if (error.message.includes('audio')) {
        errorMessage = error.message;
      } else {
        errorMessage = `エラー: ${error.message}`;
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// ファイルサイズ制限を設定（Next.js 13+）
export const runtime = 'nodejs';
export const maxDuration = 300; // 5分のタイムアウト

// ファイルサイズ制限（Vercel）
export const dynamic = 'force-dynamic';
export const preferredRegion = 'auto';
import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio, getMimeType, estimateAudioDuration } from '@/lib/gemini';
import { AudioChunker, getOptimalChunkSize } from '@/lib/audio-chunker';

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

    // 音声ファイルの推定時間を計算
    const estimatedDuration = estimateAudioDuration(audioFile.size, mimeType);
    const estimatedMinutes = Math.round((audioFile.size * 8) / (128 * 1000 * 60)); // MP3 128kbps基準

    console.log(`Processing audio file: ${audioFile.name}, size: ${audioFile.size} bytes, type: ${mimeType}, estimated duration: ${estimatedDuration}`);

    // 処理開始時間を記録
    const startTime = Date.now();

    let transcriptionText: string;

    // 長時間音声の場合は分割処理
    if (estimatedMinutes > 5) {
      console.log(`Long audio detected (${estimatedMinutes} minutes), using chunked processing`);

      const chunker = new AudioChunker();
      const chunkDuration = getOptimalChunkSize(audioFile.size, estimatedMinutes);

      console.log(`Chunking audio into ${chunkDuration}-second segments`);

      const chunks = await chunker.chunkAudio(arrayBuffer, chunkDuration);
      console.log(`Created ${chunks.length} chunks`);

      const transcriptions: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.startTime.toFixed(1)}s - ${chunk.endTime.toFixed(1)}s)`);

        try {
          const chunkBuffer = Buffer.from(chunk.buffer);
          const chunkText = await transcribeAudio(chunkBuffer, 'audio/wav');

          if (chunkText && chunkText.trim().length > 0) {
            // タイムスタンプ付きでテキストを保存
            const timestampedText = `[${Math.floor(chunk.startTime / 60)}:${(chunk.startTime % 60).toFixed(0).padStart(2, '0')} - ${Math.floor(chunk.endTime / 60)}:${(chunk.endTime % 60).toFixed(0).padStart(2, '0')}]\n${chunkText}`;
            transcriptions.push(timestampedText);
          }
        } catch (error) {
          console.error(`Error processing chunk ${i + 1}:`, error);
          transcriptions.push(`[${Math.floor(chunk.startTime / 60)}:${(chunk.startTime % 60).toFixed(0).padStart(2, '0')} - ${Math.floor(chunk.endTime / 60)}:${(chunk.endTime % 60).toFixed(0).padStart(2, '0')}]\n[処理エラー]`);
        }

        // レート制限回避のため各チャンク間に遅延を追加
        if (i < chunks.length - 1) {
          console.log('Waiting 15 seconds before processing next chunk...');
          await new Promise(resolve => setTimeout(resolve, 15000));
        }
      }

      transcriptionText = transcriptions.join('\n\n');
    } else {
      console.log('Short audio detected, processing as single file');
      transcriptionText = await transcribeAudio(buffer, mimeType);
    }

    // 処理時間を計算
    const processingTimeMs = Date.now() - startTime;
    const processingTimeFormatted = `${Math.floor(processingTimeMs / 60000)}分${Math.floor((processingTimeMs % 60000) / 1000)}秒`;

    return NextResponse.json({
      text: transcriptionText,
      fileName: audioFile.name,
      fileSize: audioFile.size,
      estimatedDuration: estimatedDuration,
      processingTime: processingTimeFormatted,
      processingTimeMs: processingTimeMs,
      timestamp: new Date().toISOString(),
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
export const maxDuration = 300; // 5分のタイムアウト（Vercel無料プラン制限）

// ファイルサイズ制限（Vercel）
export const dynamic = 'force-dynamic';
export const preferredRegion = 'auto';
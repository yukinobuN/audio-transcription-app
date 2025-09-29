import { NextRequest } from 'next/server';
import { transcribeAudio, getMimeType, estimateAudioDuration } from '@/lib/gemini';
import { AudioChunker, getOptimalChunkSize } from '@/lib/audio-chunker';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return new Response(
        JSON.stringify({ error: '音声ファイルが見つかりません' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ファイルサイズチェック（100MB）
    const maxSize = 100 * 1024 * 1024;
    if (audioFile.size > maxSize) {
      return new Response(
        JSON.stringify({ error: 'ファイルサイズが100MBを超えています' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ファイル形式チェック
    const allowedExtensions = ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.webm'];
    const fileExtension = '.' + audioFile.name.toLowerCase().split('.').pop();

    if (!allowedExtensions.includes(fileExtension)) {
      return new Response(
        JSON.stringify({ error: '対応していないファイル形式です。MP3、M4A、WAV、FLAC、OGG、WebMファイルをお選びください。' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Server-Sent Eventsのストリームを作成
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        processAudioStream(audioFile, controller, encoder);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    });

  } catch (error) {
    console.error('Transcription stream error:', error);
    return new Response(
      JSON.stringify({ error: '音声の変換中にエラーが発生しました' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function processAudioStream(
  audioFile: File,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  let isStreamClosed = false;

  // ストリームが閉じられた場合の検知
  const checkStreamStatus = () => {
    if (controller.desiredSize === null) {
      isStreamClosed = true;
      console.log('Stream closed by client');
      return false;
    }
    return true;
  };

  try {
    // ファイルをBufferに変換
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // MIMEタイプを取得
    const mimeType = getMimeType(audioFile.name);

    // 音声ファイルの推定時間を計算
    const estimatedDuration = estimateAudioDuration(audioFile.size, mimeType);
    const estimatedMinutes = Math.round((audioFile.size * 8) / (128 * 1000 * 60));

    // 開始情報を送信
    sendEvent(controller, encoder, 'start', {
      fileName: audioFile.name,
      fileSize: audioFile.size,
      estimatedDuration,
      estimatedMinutes,
    });

    // 処理開始時間を記録
    const startTime = Date.now();

    let transcriptionText: string;
    const allChunkResults: Array<{
      chunkIndex: number;
      startTime: number;
      endTime: number;
      text: string;
      status: 'success' | 'error';
    }> = [];

    // 長時間音声の場合は分割処理
    if (estimatedMinutes > 5) {
      sendEvent(controller, encoder, 'info', {
        message: `Long audio detected (${estimatedMinutes} minutes), using chunked processing`
      });

      const chunker = new AudioChunker();
      const chunkDuration = getOptimalChunkSize(audioFile.size, estimatedMinutes);

      sendEvent(controller, encoder, 'info', {
        message: `Chunking audio into ${chunkDuration}-second segments`
      });

      const chunks = await chunker.chunkAudio(arrayBuffer, chunkDuration);

      sendEvent(controller, encoder, 'chunks-created', {
        totalChunks: chunks.length,
        chunkDuration
      });

      const transcriptions: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        // ストリームが閉じられているかチェック
        if (!checkStreamStatus()) {
          console.log(`Stream closed, stopping at chunk ${i + 1}/${chunks.length}`);
          break;
        }

        const chunk = chunks[i];

        sendEvent(controller, encoder, 'chunk-start', {
          chunkIndex: i + 1,
          totalChunks: chunks.length,
          startTime: chunk.startTime,
          endTime: chunk.endTime
        });

        try {
          const chunkBuffer = Buffer.from(chunk.buffer);
          const chunkText = await transcribeAudio(chunkBuffer, 'audio/wav');

          if (chunkText && chunkText.trim().length > 0) {
            const timestampedText = `[${Math.floor(chunk.startTime / 60)}:${(chunk.startTime % 60).toFixed(0).padStart(2, '0')} - ${Math.floor(chunk.endTime / 60)}:${(chunk.endTime % 60).toFixed(0).padStart(2, '0')}]\n${chunkText}`;
            transcriptions.push(timestampedText);

            const chunkResult = {
              chunkIndex: i + 1,
              startTime: chunk.startTime,
              endTime: chunk.endTime,
              text: chunkText,
              status: 'success' as const
            };
            allChunkResults.push(chunkResult);

            sendEvent(controller, encoder, 'chunk-complete', chunkResult);
          }
        } catch (error) {
          console.error(`Error processing chunk ${i + 1}:`, error);
          const errorText = `[${Math.floor(chunk.startTime / 60)}:${(chunk.startTime % 60).toFixed(0).padStart(2, '0')} - ${Math.floor(chunk.endTime / 60)}:${(chunk.endTime % 60).toFixed(0).padStart(2, '0')}]\n[処理エラー]`;
          transcriptions.push(errorText);

          const chunkResult = {
            chunkIndex: i + 1,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
            text: '[処理エラー]',
            status: 'error' as const
          };
          allChunkResults.push(chunkResult);

          sendEvent(controller, encoder, 'chunk-error', chunkResult);
        }

        // 次のチャンクまでの待機時間を送信
        if (i < chunks.length - 1) {
          if (!checkStreamStatus()) {
            console.log('Stream closed during processing, stopping wait');
            break;
          }

          sendEvent(controller, encoder, 'waiting', {
            message: 'Waiting 15 seconds before processing next chunk...',
            waitTime: 15
          });

          // 15秒待機中もストリーム状態をチェック
          let waitTime = 0;
          while (waitTime < 15000 && checkStreamStatus()) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            waitTime += 1000;
          }

          if (!checkStreamStatus()) {
            console.log('Stream closed during wait, stopping');
            break;
          }
        }
      }

      transcriptionText = transcriptions.join('\n\n');
    } else {
      sendEvent(controller, encoder, 'info', {
        message: 'Short audio detected, processing as single file'
      });
      transcriptionText = await transcribeAudio(buffer, mimeType);
    }

    // 処理時間を計算
    const processingTimeMs = Date.now() - startTime;
    const processingTimeFormatted = `${Math.floor(processingTimeMs / 60000)}分${Math.floor((processingTimeMs % 60000) / 1000)}秒`;

    // 完了情報を送信（ストリームが有効な場合のみ）
    if (checkStreamStatus()) {
      sendEvent(controller, encoder, 'complete', {
        text: transcriptionText,
        fileName: audioFile.name,
        fileSize: audioFile.size,
        estimatedDuration: estimatedDuration,
        processingTime: processingTimeFormatted,
        processingTimeMs: processingTimeMs,
        timestamp: new Date().toISOString(),
        allChunkResults
      });
    }

    if (!isStreamClosed) {
      controller.close();
    }

  } catch (error) {
    console.error('Stream processing error:', error);

    let errorMessage = '音声の変換中にエラーが発生しました';
    if (error instanceof Error) {
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

    sendEvent(controller, encoder, 'error', { error: errorMessage });
    controller.close();
  }
}

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  type: string,
  data: any
) {
  try {
    // より厳密にコントローラーの状態をチェック
    if (controller.desiredSize !== null && !controller.signal?.aborted) {
      const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(message));
    }
  } catch (error) {
    // コントローラーが閉じられた場合はエラーログを抑制
    if (error.code !== 'ERR_INVALID_STATE') {
      console.warn('Failed to send event:', error);
    }
  }
}

export const runtime = 'nodejs';
export const maxDuration = 900;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'auto';
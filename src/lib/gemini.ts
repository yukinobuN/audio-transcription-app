import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const genAI = new GoogleGenerativeAI(apiKey);

// 利用可能なモデルを確認（ログ出力のみ）
function logAvailableModels() {
  console.log('Trying Gemini 2.0 models in order: gemini-2.0-flash-exp, gemini-2.0-flash-thinking-exp, gemini-2.0-flash');
}

export async function transcribeAudio(audioFile: Buffer, mimeType: string): Promise<string> {
  try {
    // 利用可能なモデルを確認
    console.log('Checking available models...');
    logAvailableModels();

    // Gemini 2.0以上のモデルのみを使用
    const modelNames = [
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-thinking-exp',
      'gemini-2.0-flash',
      'models/gemini-2.0-flash-exp'
    ];

    let lastError;

    for (const modelName of modelNames) {
      try {
        console.log(`Trying model: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });

        return await processWithModel(model, audioFile, mimeType);
      } catch (error) {
        console.warn(`Model ${modelName} failed:`, error);
        lastError = error;
        continue;
      }
    }

    throw lastError;
  } catch (error) {
    console.error('Gemini API transcription error:', error);
    if (error instanceof Error) {
      throw new Error(`音声変換エラー: ${error.message}`);
    }
    throw new Error('音声の変換中に予期しないエラーが発生しました');
  }
}

async function processWithModel(model: any, audioFile: Buffer, mimeType: string): Promise<string> {
  // M4Aファイルの場合はMP3として処理（Gemini APIでaudio/mp4がサポートされていないため）
  const mimeTypesToTry = mimeType === 'audio/mp4'
    ? ['audio/mpeg', 'audio/mp3']
    : [mimeType];

  for (const tryMimeType of mimeTypesToTry) {
    try {
      console.log(`Trying MIME type: ${tryMimeType}`);
      return await processWithModelAndMime(model, audioFile, tryMimeType);
    } catch (error) {
      console.warn(`Failed with MIME type ${tryMimeType}:`, error);
      if (tryMimeType === mimeTypesToTry[mimeTypesToTry.length - 1]) {
        throw error;
      }
      continue;
    }
  }

  throw new Error('All MIME type attempts failed');
}

async function processWithModelAndMime(model: any, audioFile: Buffer, mimeType: string): Promise<string> {
  const prompt = `
あなたは音声転写の専門家です。提供された音声ファイルを完全に、最初から最後まで正確に文字起こししてください。

【重要な指示】
1. 音声ファイル全体を完全に処理し、途中で停止しないでください
2. 長時間の音声でも最後まで聞き取り、すべての内容を文字起こししてください
3. 音声の開始から終了まで、一切の内容を省略しないでください
4. 話者が変わる場合は改行で区切ってください
5. 音声が長い場合も、全ての発言を記録してください

【書式指示】
- 話されている内容をそのまま文字起こししてください
- 句読点を適切に付けてください
- 聞き取れない部分は[不明]と記載してください
- 日本語の場合は自然な日本語の文章として整形してください
- 会話や内容の区切りごとに改行を入れてください
- 長い音声の場合は、適切に段落分けを行ってください

【注意】
この音声は長時間の可能性がありますが、必ず最後まで完全に処理してください。
部分的な処理や途中での終了は絶対に行わないでください。
`;

  console.log(`Audio buffer size: ${audioFile.length} bytes, MIME: ${mimeType}`);

  // 音声データの最小サイズチェック
  if (audioFile.length < 1000) {
    throw new Error('音声ファイルが小さすぎます。最低で1KB以上の音声が必要です。');
  }

  // M4Aファイルの特別処理
  if (mimeType === 'audio/mp4') {
    console.log('🔊 Processing M4A file - using enhanced processing mode');
  }

  // より大きなtimeoutとretryロジックを設定
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      console.log(`Processing attempt ${retryCount + 1}/${maxRetries}`);


      // Base64エンコーディング前のチェック
      console.log(`Encoding ${audioFile.length} bytes to base64 with MIME type: ${mimeType}`);
      const base64Data = audioFile.toString('base64');

      if (!base64Data || base64Data.length === 0) {
        throw new Error('音声データのbase64エンコーディングに失敗しました');
      }

      console.log(`Base64 encoded successfully: ${base64Data.length} characters`);

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
      ]);

      const response = await result.response;
      const text = response.text();

      if (!text || text.trim().length === 0) {
        throw new Error('音声の変換に失敗しました。音声が明瞭でない可能性があります。');
      }

      console.log(`Transcription completed. Text length: ${text.length} characters`);
      return text.trim();

    } catch (error) {
      retryCount++;
      console.warn(`Attempt ${retryCount} failed:`, error);

      if (retryCount >= maxRetries) {
        throw error;
      }

      // レート制限対応のため長めの待機時間
      await new Promise(resolve => setTimeout(resolve, 20000)); // 20秒待機
    }
  }

  throw new Error('最大リトライ回数に達しました');
}

// ファイルのMIMEタイプを判定（Gemini API対応版）
export function getMimeType(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop();

  switch (extension) {
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      // M4Aは一部のAIモデルで問題があるため、MP3として扱うこともある
      console.warn('⚠️ M4A files may have compatibility issues with some AI models');
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    default:
      return 'audio/mpeg';
  }
}

// 音声ファイルサイズから推定時間を計算（概算）
export function estimateAudioDuration(fileSize: number, mimeType: string): string {
  // 大まかなビットレート推定（kbps）
  const bitRateEstimates: { [key: string]: number } = {
    'audio/mpeg': 128, // MP3
    'audio/mp4': 128,  // M4A
    'audio/wav': 1411, // WAV (非圧縮)
    'audio/flac': 700, // FLAC
    'audio/ogg': 128,  // OGG
    'audio/webm': 128, // WebM
  };

  const bitRate = bitRateEstimates[mimeType] || 128;
  const durationSeconds = Math.round((fileSize * 8) / (bitRate * 1000));

  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = durationSeconds % 60;

  if (hours > 0) {
    return `約${hours}時間${minutes}分${seconds}秒`;
  } else if (minutes > 0) {
    return `約${minutes}分${seconds}秒`;
  } else {
    return `約${seconds}秒`;
  }
}
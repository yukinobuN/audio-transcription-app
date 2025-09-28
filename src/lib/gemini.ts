import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const genAI = new GoogleGenerativeAI(apiKey);

// 利用可能なモデルを確認（ログ出力のみ）
function logAvailableModels() {
  console.log('Trying models in order: gemini-2.0-flash-exp, gemini-1.5-pro-002, gemini-1.5-pro-latest, gemini-1.5-pro');
}

export async function transcribeAudio(audioFile: Buffer, mimeType: string): Promise<string> {
  try {
    // 利用可能なモデルを確認
    console.log('Checking available models...');
    logAvailableModels();

    // 最新モデルを順番に試行（Gemini 2.0 Flash → Gemini 1.5 Pro）
    const modelNames = [
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro-002',
      'gemini-1.5-pro-latest',
      'gemini-1.5-pro',
      'models/gemini-1.5-pro',
      'models/gemini-1.5-flash',
      'gemini-pro'
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
  const prompt = `
この音声ファイルの内容を正確にテキストに変換してください。
以下の点に注意してください：
- 話されている内容をそのまま文字起こししてください
- 句読点を適切に付けてください
- 聞き取れない部分は[不明]と記載してください
- 日本語の場合は自然な日本語の文章として整形してください
`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: audioFile.toString('base64'),
        mimeType: mimeType,
      },
    },
  ]);

  const response = await result.response;
  const text = response.text();

  if (!text || text.trim().length === 0) {
    throw new Error('音声の変換に失敗しました。音声が明瞭でない可能性があります。');
  }

  return text.trim();
}

// ファイルのMIMEタイプを判定
export function getMimeType(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop();

  switch (extension) {
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
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
      return 'audio/mpeg'; // デフォルトはMP3として扱う
  }
}
// 音声ファイルを分割して処理するためのユーティリティ

export interface AudioChunk {
  buffer: ArrayBuffer;
  startTime: number;
  endTime: number;
  chunkIndex: number;
}

export class AudioChunker {
  private audioContext: AudioContext | null = null;

  constructor() {
    // AudioContextをサーバーサイドでは作成しない
    if (typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  // 音声ファイルを指定された時間で分割
  async chunkAudio(audioBuffer: ArrayBuffer, chunkDurationSeconds: number = 120): Promise<AudioChunk[]> {
    if (!this.audioContext) {
      // サーバーサイドでは単純にバイト分割
      return this.chunkByBytes(audioBuffer, chunkDurationSeconds);
    }

    try {
      const decodedAudio = await this.audioContext.decodeAudioData(audioBuffer.slice(0));
      return this.chunkDecodedAudio(decodedAudio, chunkDurationSeconds);
    } catch (error) {
      console.warn('Failed to decode audio, falling back to byte chunking:', error);
      return this.chunkByBytes(audioBuffer, chunkDurationSeconds);
    }
  }

  // 音声データを時間ベースで分割
  private chunkDecodedAudio(audioBuffer: AudioBuffer, chunkDurationSeconds: number): AudioChunk[] {
    const chunks: AudioChunk[] = [];
    const sampleRate = audioBuffer.sampleRate;
    const samplesPerChunk = sampleRate * chunkDurationSeconds;
    const totalSamples = audioBuffer.length;

    for (let i = 0; i < totalSamples; i += samplesPerChunk) {
      const endSample = Math.min(i + samplesPerChunk, totalSamples);
      const chunkLength = endSample - i;

      // 新しいAudioBufferを作成
      const chunkBuffer = this.audioContext!.createBuffer(
        audioBuffer.numberOfChannels,
        chunkLength,
        sampleRate
      );

      // チャンネルデータをコピー
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel);
        const targetData = chunkBuffer.getChannelData(channel);
        for (let sample = 0; sample < chunkLength; sample++) {
          targetData[sample] = sourceData[i + sample];
        }
      }

      // WAV形式にエンコード
      const wavBuffer = this.encodeWAV(chunkBuffer);

      chunks.push({
        buffer: wavBuffer,
        startTime: i / sampleRate,
        endTime: endSample / sampleRate,
        chunkIndex: chunks.length,
      });
    }

    return chunks;
  }

  // バイト単位での単純分割（フォールバック）
  private chunkByBytes(audioBuffer: ArrayBuffer, chunkDurationSeconds: number): AudioChunk[] {
    const chunks: AudioChunk[] = [];
    const chunkSize = Math.floor(audioBuffer.byteLength / (40 * 60 / chunkDurationSeconds)); // 40分を基準とした概算

    for (let i = 0; i < audioBuffer.byteLength; i += chunkSize) {
      const end = Math.min(i + chunkSize, audioBuffer.byteLength);
      const chunk = audioBuffer.slice(i, end);

      chunks.push({
        buffer: chunk,
        startTime: (i / audioBuffer.byteLength) * 40 * 60, // 40分と仮定
        endTime: (end / audioBuffer.byteLength) * 40 * 60,
        chunkIndex: chunks.length,
      });
    }

    return chunks;
  }

  // AudioBufferをWAV形式にエンコード
  private encodeWAV(audioBuffer: AudioBuffer): ArrayBuffer {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAVヘッダーを書き込み
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // オーディオデータを書き込み
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return buffer;
  }
}

// 最適なチャンクサイズを決定
export function getOptimalChunkSize(fileSizeBytes: number, estimatedDurationMinutes: number): number {
  // 長時間音声の場合は小さなチャンクに分割
  if (estimatedDurationMinutes > 30) {
    return 60; // 1分チャンク
  } else if (estimatedDurationMinutes > 15) {
    return 120; // 2分チャンク
  } else if (estimatedDurationMinutes > 5) {
    return 180; // 3分チャンク
  } else {
    return 300; // 5分チャンク（短い音声は分割しない）
  }
}
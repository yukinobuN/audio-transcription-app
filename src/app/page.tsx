'use client';

import { useState, useRef } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import ErrorMessage from '@/components/ErrorMessage';

interface TranscriptionResult {
  text: string;
  fileName: string;
  timestamp: string;
}

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      // ファイルサイズチェック（100MB = 100 * 1024 * 1024 bytes）
      if (selectedFile.size > 100 * 1024 * 1024) {
        setError('ファイルサイズが100MBを超えています。');
        return;
      }

      // ファイル形式チェック
      const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/flac'];
      if (!allowedTypes.includes(selectedFile.type) &&
          !selectedFile.name.toLowerCase().endsWith('.m4a') &&
          !selectedFile.name.toLowerCase().endsWith('.mp3')) {
        setError('対応していないファイル形式です。MP3、M4A、WAV、FLACファイルをお選びください。');
        return;
      }

      setFile(selectedFile);
      setError(null);
      setTranscriptionResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setUploadProgress('ファイルを送信中...');

    try {
      const formData = new FormData();
      formData.append('audio', file);

      setUploadProgress('音声を解析中...');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'アップロードに失敗しました');
      }

      setUploadProgress('テキストを生成中...');
      const result = await response.json();

      setTranscriptionResult({
        text: result.text,
        fileName: file.name,
        timestamp: new Date().toLocaleString('ja-JP'),
      });

      // ファイル選択をリセット
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  const copyToClipboard = async () => {
    if (transcriptionResult?.text) {
      try {
        await navigator.clipboard.writeText(transcriptionResult.text);
        alert('テキストをクリップボードにコピーしました');
      } catch (err) {
        console.error('コピーに失敗しました:', err);
      }
    }
  };

  const downloadText = () => {
    if (transcriptionResult?.text) {
      const blob = new Blob([transcriptionResult.text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcription_${transcriptionResult.fileName}_${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">音声ファイルのアップロード</h2>

        <div className="mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.m4a,.wav,.flac,audio/*"
            onChange={handleFileSelect}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <p className="text-sm text-gray-600 mt-2">
            対応形式: MP3, M4A, WAV, FLAC（最大100MB）
          </p>
        </div>

        {file && (
          <div className="mb-4 p-3 bg-gray-100 rounded">
            <p className="text-sm">
              <strong>選択されたファイル:</strong> {file.name}
            </p>
            <p className="text-sm text-gray-600">
              サイズ: {(file.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4">
            <ErrorMessage
              message={error}
              onRetry={() => {
                setError(null);
                if (file) {
                  handleUpload();
                }
              }}
            />
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || isUploading}
          className={`px-6 py-2 rounded font-medium ${
            !file || isUploading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isUploading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {uploadProgress || '変換中...'}
            </span>
          ) : (
            'テキスト化を開始'
          )}
        </button>

        {isUploading && (
          <div className="mt-4">
            <LoadingSpinner message={uploadProgress} />
          </div>
        )}
      </div>

      {transcriptionResult && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">変換結果</h3>
            <div className="space-x-2">
              <button
                onClick={copyToClipboard}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                コピー
              </button>
              <button
                onClick={downloadText}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                ダウンロード
              </button>
            </div>
          </div>

          <div className="mb-2 text-sm text-gray-600">
            <p>ファイル名: {transcriptionResult.fileName}</p>
            <p>変換日時: {transcriptionResult.timestamp}</p>
          </div>

          <div className="border border-gray-300 rounded p-4 bg-gray-50 max-h-96 overflow-y-auto">
            <pre className="whitespace-pre-wrap text-sm">{transcriptionResult.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
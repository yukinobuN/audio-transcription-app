'use client';

import { useState, useRef } from 'react';

interface ChunkResult {
  chunkIndex: number;
  startTime: number;
  endTime: number;
  text: string;
  status: 'success' | 'error';
}

interface TranscriptionResult {
  text: string;
  fileName: string;
  fileSize: number;
  estimatedDuration: string;
  processingTime: string;
  processingTimeMs: number;
  timestamp: string;
  allChunkResults?: ChunkResult[];
}

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useStreaming, setUseStreaming] = useState(true);
  const [processingInfo, setProcessingInfo] = useState<{
    totalChunks?: number;
    currentChunk?: number;
    chunkResults: ChunkResult[];
    isWaiting?: boolean;
    waitMessage?: string;
  }>({ chunkResults: [] });
  const [liveTranscript, setLiveTranscript] = useState<string>('');
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
    setProcessingInfo({ chunkResults: [] });
    setTranscriptionResult(null);
    setLiveTranscript('');

    const fileSize = file.size / (1024 * 1024); // MB
    const isLargeFile = fileSize > 10;

    try {
      const formData = new FormData();
      formData.append('audio', file);

      if (useStreaming) {
        // ストリーミング処理
        const response = await fetch('/api/transcribe-stream', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('アップロードに失敗しました');
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('ストリーミングの読み取りに失敗しました');
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('event:')) {
              const eventType = line.substring(6).trim();
              const nextLine = lines[lines.indexOf(line) + 1];
              if (nextLine && nextLine.startsWith('data:')) {
                const data = JSON.parse(nextLine.substring(5).trim());
                handleStreamEvent(eventType, data);
              }
            }
          }
        }
      } else {
        // 従来の処理
        if (isLargeFile) {
          setUploadProgress('音声を分割して解析中... (数分かかる場合があります)');
        } else {
          setUploadProgress('音声を解析中...');
        }

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
          fileName: result.fileName,
          fileSize: result.fileSize,
          estimatedDuration: result.estimatedDuration,
          processingTime: result.processingTime,
          processingTimeMs: result.processingTimeMs,
          timestamp: new Date().toLocaleString('ja-JP'),
        });
      }

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
      setProcessingInfo(prev => ({ ...prev, isWaiting: false, waitMessage: undefined }));
    }
  };

  const handleStreamEvent = (eventType: string, data: any) => {
    switch (eventType) {
      case 'start':
        setUploadProgress(`処理開始: ${data.fileName} (${data.estimatedDuration})`);
        break;
      case 'info':
        setUploadProgress(data.message);
        break;
      case 'chunks-created':
        setProcessingInfo(prev => ({
          ...prev,
          totalChunks: data.totalChunks
        }));
        setUploadProgress(`${data.totalChunks}個のチャンクに分割しました`);
        break;
      case 'chunk-start':
        setProcessingInfo(prev => ({
          ...prev,
          currentChunk: data.chunkIndex,
          isWaiting: false
        }));
        setUploadProgress(`チャンク ${data.chunkIndex}/${data.totalChunks} を処理中... (${Math.floor(data.startTime/60)}:${(data.startTime%60).toFixed(0).padStart(2,'0')} - ${Math.floor(data.endTime/60)}:${(data.endTime%60).toFixed(0).padStart(2,'0')})`);
        break;
      case 'chunk-complete':
        setProcessingInfo(prev => ({
          ...prev,
          chunkResults: [...prev.chunkResults, data]
        }));
        setLiveTranscript(prev => {
          if (prev) {
            return `${prev}\n\n[${Math.floor(data.startTime/60)}:${(data.startTime%60).toFixed(0).padStart(2,'0')} - ${Math.floor(data.endTime/60)}:${(data.endTime%60).toFixed(0).padStart(2,'0')}]\n${data.text}`;
          } else {
            return `[${Math.floor(data.startTime/60)}:${(data.startTime%60).toFixed(0).padStart(2,'0')} - ${Math.floor(data.endTime/60)}:${(data.endTime%60).toFixed(0).padStart(2,'0')}]\n${data.text}`;
          }
        });
        setUploadProgress(`チャンク ${data.chunkIndex} 完了 (${data.text.length}文字)`);
        break;
      case 'chunk-error':
        setProcessingInfo(prev => ({
          ...prev,
          chunkResults: [...prev.chunkResults, data]
        }));
        setUploadProgress(`チャンク ${data.chunkIndex} でエラーが発生`);
        break;
      case 'waiting':
        setProcessingInfo(prev => ({
          ...prev,
          isWaiting: true,
          waitMessage: data.message
        }));
        setUploadProgress(`待機中... (${data.waitTime}秒)`);
        break;
      case 'complete':
        setTranscriptionResult({
          text: data.text,
          fileName: data.fileName,
          fileSize: data.fileSize,
          estimatedDuration: data.estimatedDuration,
          processingTime: data.processingTime,
          processingTimeMs: data.processingTimeMs,
          timestamp: new Date().toLocaleString('ja-JP'),
          allChunkResults: data.allChunkResults,
        });
        setUploadProgress('処理完了！');
        break;
      case 'error':
        setError(data.error);
        break;
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">音声文字起こし【確認用テスト20250929】</h1>
            </div>
            <div className="text-sm text-gray-500">Powered by Gemini 2.0</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Upload Section */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">ファイルアップロード</h2>

                {/* Upload Area */}
                <div className="relative">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mp3,.m4a,.wav,.flac,audio/*"
                    onChange={handleFileSelect}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
                    file
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                  }`}>
                    <div className="flex flex-col items-center">
                      {file ? (
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mb-3">
                          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                      ) : (
                        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                      )}
                      <h3 className="text-base font-medium text-gray-900 mb-2">
                        {file ? file.name : 'ファイルを選択'}
                      </h3>
                      <p className="text-sm text-gray-500 mb-4">
                        {file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : 'ドラッグ&ドロップまたはクリック'}
                      </p>
                      <div className="flex gap-2 text-xs">
                        {['MP3', 'M4A', 'WAV', 'FLAC'].map((format) => (
                          <span key={format} className="px-2 py-1 bg-gray-100 text-gray-600 rounded-md">{format}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Settings */}
                <div className="mt-6">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={useStreaming}
                      onChange={(e) => setUseStreaming(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-3 text-sm text-gray-700">リアルタイム進捗表示</span>
                  </label>
                  <p className="mt-1 text-xs text-gray-500">
                    処理状況をリアルタイムで確認できます（推奨）
                  </p>
                </div>

                {/* Upload Button */}
                <button
                  onClick={handleUpload}
                  disabled={!file || isUploading}
                  className={`w-full mt-6 py-3 px-4 rounded-xl font-medium text-sm transition-all duration-200 ${
                    !file || isUploading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-lg hover:shadow-xl'
                  }`}
                >
                  {isUploading ? (
                    <span>処理中...</span>
                  ) : (
                    '文字起こしを開始'
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Results Section */}
          <div className="lg:col-span-2 space-y-6">
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                <div className="flex">
                  <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                    <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-red-800">エラーが発生しました</h4>
                    <p className="mt-1 text-sm text-red-700">{error}</p>
                    <button
                      onClick={() => {
                        setError(null);
                        if (file) {
                          handleUpload();
                        }
                      }}
                      className="mt-3 text-sm text-red-600 hover:text-red-800 font-medium"
                    >
                      再試行する
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Processing Status */}
            {isUploading && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">処理状況</h3>
                  </div>

                  <p className="text-sm text-gray-600 mb-4">{uploadProgress || '処理中...'}</p>

                  {/* Progress Bar */}
                  {useStreaming && processingInfo.totalChunks && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-600">進捗</span>
                        <span className="text-sm text-gray-900 font-medium">
                          {processingInfo.currentChunk || 0} / {processingInfo.totalChunks}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-blue-600 to-purple-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${((processingInfo.currentChunk || 0) / processingInfo.totalChunks) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  {/* Waiting Status */}
                  {processingInfo.isWaiting && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
                      <div className="w-4 h-4 bg-yellow-100 rounded-full flex items-center justify-center mr-2">
                        <svg className="animate-spin w-3 h-3 text-yellow-600" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </div>
                      <span className="text-sm text-yellow-800">レート制限回避のため待機中...</span>
                    </div>
                  )}

                  {/* Completed Chunks */}
                  {useStreaming && processingInfo.chunkResults.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-900 mb-3">
                        完了したセグメント ({processingInfo.chunkResults.length})
                      </h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {processingInfo.chunkResults.map((chunk, index) => (
                          <div
                            key={index}
                            className={`p-3 rounded-xl border ${
                              chunk.status === 'success'
                                ? 'bg-green-50 border-green-200'
                                : 'bg-red-50 border-red-200'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-900">
                                #{chunk.chunkIndex}
                              </span>
                              <span className="text-xs text-gray-500">
                                {Math.floor(chunk.startTime/60)}:{(chunk.startTime%60).toFixed(0).padStart(2,'0')} - {Math.floor(chunk.endTime/60)}:{(chunk.endTime%60).toFixed(0).padStart(2,'0')}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600">
                              {chunk.status === 'success'
                                ? `${chunk.text.length}文字生成`
                                : '処理エラー'
                              }
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Live Preview */}
            {isUploading && liveTranscript && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">リアルタイムプレビュー</h3>
                  <div className="bg-gray-50 rounded-xl p-4 max-h-80 overflow-y-auto">
                    <pre className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                      {liveTranscript}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* Results */}
            {transcriptionResult && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-4">
                        <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">文字起こし完了</h3>
                        <p className="text-sm text-gray-600">{transcriptionResult.text.length.toLocaleString()}文字を生成しました</p>
                      </div>
                    </div>
                    <div className="flex space-x-3">
                      <button
                        onClick={copyToClipboard}
                        className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        コピー
                      </button>
                      <button
                        onClick={downloadText}
                        className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl text-sm font-medium hover:from-blue-700 hover:to-purple-700 transition-all"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        ダウンロード
                      </button>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="bg-gray-50 border-b border-gray-200 p-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: 'ファイルサイズ', value: `${(transcriptionResult.fileSize / (1024 * 1024)).toFixed(1)}MB` },
                      { label: '音声時間', value: transcriptionResult.estimatedDuration.replace('約', '') },
                      { label: '処理時間', value: transcriptionResult.processingTime },
                      { label: '文字数', value: transcriptionResult.text.length.toLocaleString() }
                    ].map((stat, index) => (
                      <div key={index} className="text-center">
                        <div className="text-lg font-semibold text-gray-900">{stat.value}</div>
                        <div className="text-xs text-gray-500">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Transcript */}
                <div className="p-6">
                  <div className="bg-gray-50 rounded-xl p-4 max-h-96 overflow-y-auto border border-gray-200">
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                      {transcriptionResult.text}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
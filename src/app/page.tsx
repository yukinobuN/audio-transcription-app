'use client';

import { useState, useRef, useEffect } from 'react';

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
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [maxFileSizeMB, setMaxFileSizeMB] = useState<number>(4);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 設定を取得
    fetch('/api/config')
      .then(res => res.json())
      .then(config => {
        setMaxFileSizeMB(config.maxFileSizeMB);
      })
      .catch(err => {
        console.warn('Failed to fetch config, using default:', err);
      });
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > maxFileSizeMB * 1024 * 1024) {
        const errorMessage = maxFileSizeMB <= 4
          ? `ファイルサイズが${maxFileSizeMB}MBを超えています。Vercel無料プランの制限により、${maxFileSizeMB}MB以下のファイルをお選びください。`
          : `ファイルサイズが${maxFileSizeMB}MBを超えています。`;
        setError(errorMessage);
        return;
      }

      const allowedExtensions = ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.webm'];
      const fileExtension = '.' + selectedFile.name.toLowerCase().split('.').pop();

      if (!allowedExtensions.includes(fileExtension)) {
        setError('対応していないファイル形式です。MP3、M4A、WAV、FLAC、OGG、WebMファイルをお選びください。');
        return;
      }

      setFile(selectedFile);
      setError(null);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) {
      const input = fileInputRef.current;
      if (input) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(droppedFile);
        input.files = dataTransfer.files;
        handleFileSelect({ target: input } as React.ChangeEvent<HTMLInputElement>);
      }
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleCancel = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsUploading(false);
      setUploadProgress('キャンセルされました');
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsUploading(true);
    setError(null);
    setTranscriptionResult(null);
    setProcessingInfo({ chunkResults: [] });
    setLiveTranscript('');

    try {
      if (useStreaming) {
        await handleStreamingUpload(controller);
      } else {
        await handleRegularUpload(controller);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setUploadProgress('処理がキャンセルされました');
      } else {
        console.error('Upload error:', error);
        setError(error instanceof Error ? error.message : '処理中にエラーが発生しました');
      }
    } finally {
      setIsUploading(false);
      setAbortController(null);
    }
  };

  const handleStreamingUpload = async (controller: AbortController) => {
    const formData = new FormData();
    formData.append('audio', file!);

    const response = await fetch('/api/transcribe-stream', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('アップロードに失敗しました');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('ストリーム読み取りエラー');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventType = line.substring(7);
          const nextLine = lines[lines.indexOf(line) + 1];
          if (nextLine && nextLine.startsWith('data: ')) {
            const data = JSON.parse(nextLine.substring(6));
            handleStreamEvent(eventType, data);
          }
        }
      }
    }
  };

  const handleStreamEvent = (eventType: string, data: any) => {
    switch (eventType) {
      case 'start':
        setUploadProgress(`処理開始: ${data.fileName} (${(data.fileSize / (1024 * 1024)).toFixed(2)} MB)`);
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
          currentChunk: data.chunkIndex
        }));
        setUploadProgress(`チャンク ${data.chunkIndex}/${data.totalChunks} を処理中...`);
        break;
      case 'chunk-complete':
        setProcessingInfo(prev => ({
          ...prev,
          chunkResults: [...prev.chunkResults, data]
        }));
        const timestampedText = `[${Math.floor(data.startTime / 60)}:${(data.startTime % 60).toFixed(0).padStart(2, '0')} - ${Math.floor(data.endTime / 60)}:${(data.endTime % 60).toFixed(0).padStart(2, '0')}]\n${data.text}`;
        setLiveTranscript(prev => prev ? `${prev}\n\n${timestampedText}` : timestampedText);
        break;
      case 'chunk-error':
        setProcessingInfo(prev => ({
          ...prev,
          chunkResults: [...prev.chunkResults, data]
        }));
        break;
      case 'waiting':
        setProcessingInfo(prev => ({
          ...prev,
          isWaiting: true,
          waitMessage: data.message
        }));
        setUploadProgress(data.message);
        break;
      case 'complete':
        setTranscriptionResult(data);
        setUploadProgress('処理完了');
        setProcessingInfo(prev => ({ ...prev, isWaiting: false }));
        break;
      case 'error':
        setError(data.error);
        break;
      case 'info':
        setUploadProgress(data.message);
        break;
    }
  };

  const handleRegularUpload = async (controller: AbortController) => {
    const formData = new FormData();
    formData.append('audio', file!);

    setUploadProgress('アップロード中...');

    const response = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'アップロードに失敗しました');
    }

    const result = await response.json();
    setTranscriptionResult(result);
    setUploadProgress('処理完了');
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setUploadProgress('コピーしました！');
      setTimeout(() => {
        if (!isUploading) {
          setUploadProgress('');
        }
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setUploadProgress('コピーに失敗しました');
    }
  };

  const downloadTranscript = () => {
    if (!transcriptionResult) return;

    const content = transcriptionResult.text;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript_${transcriptionResult.fileName.replace(/\.[^/.]+$/, '')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <h1 style={{
        fontSize: '32px',
        fontWeight: 'bold',
        color: '#000000',
        marginBottom: '32px',
        textAlign: 'center'
      }}>
        音声要約アプリ
      </h1>

      <div style={{
        width: '100%',
        maxWidth: '600px',
        border: '2px dashed #d1d5db',
        borderRadius: '12px',
        padding: '48px 24px',
        backgroundColor: '#ffffff',
        textAlign: 'center'
      }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.m4a,.wav,.flac,.ogg,.webm"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          id="file-upload"
        />

        <div style={{
          width: '80px',
          height: '80px',
          backgroundColor: '#f3f4f6',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px auto'
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>

        <h2 style={{
          fontSize: '20px',
          fontWeight: '600',
          color: '#000000',
          marginBottom: '12px'
        }}>
          音声ファイルをアップロード
        </h2>

        <p style={{
          fontSize: '16px',
          color: '#6b7280',
          marginBottom: '8px'
        }}>
          {file
            ? `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`
            : 'ファイルをドラッグ&ドロップするか、下のボタンから選択してください'
          }
        </p>

        <p style={{
          fontSize: '14px',
          color: '#9ca3af',
          marginBottom: '32px'
        }}>
          対応形式: MP3, WAV, M4A, OGG
        </p>

        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 24px',
            backgroundColor: '#000000',
            color: '#ffffff',
            borderRadius: '8px',
            border: 'none',
            fontSize: '16px',
            fontWeight: '500',
            cursor: 'pointer',
            marginBottom: file ? '24px' : '0'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7,10 12,15 17,10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          ファイルを選択
        </button>

        {file && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <input
                type="checkbox"
                checked={useStreaming}
                onChange={(e) => setUseStreaming(e.target.checked)}
                style={{ marginRight: '8px' }}
              />
              <label style={{ fontSize: '14px', color: '#374151' }}>
                リアルタイム進捗表示を有効にする
              </label>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleUpload}
                disabled={isUploading}
                style={{
                  flex: 1,
                  padding: '12px 24px',
                  backgroundColor: isUploading ? '#d1d5db' : '#2563eb',
                  color: '#ffffff',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: isUploading ? 'not-allowed' : 'pointer'
                }}
              >
                {isUploading ? '処理中...' : '文字起こしを開始'}
              </button>

              {isUploading && (
                <button
                  onClick={handleCancel}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '16px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  キャンセル
                </button>
              )}
            </div>
          </div>
        )}

        {(isUploading || liveTranscript) && (
          <div style={{ marginTop: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#000000', margin: 0 }}>
                {isUploading ? '処理中' : '文字起こし結果'}
              </h3>
              <div style={{ display: 'flex', gap: '12px' }}>
                {liveTranscript && (
                  <button
                    onClick={() => copyToClipboard(liveTranscript)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#059669',
                      color: '#ffffff',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    途中結果をコピー
                  </button>
                )}

                {!isUploading && (liveTranscript || transcriptionResult) && (
                  <button
                    onClick={() => window.location.reload()}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#6b7280',
                      color: '#ffffff',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    新規作成
                  </button>
                )}
              </div>
            </div>

            {uploadProgress && (
              <div style={{
                padding: '12px 16px',
                backgroundColor: '#f0f9ff',
                border: '1px solid #0ea5e9',
                borderRadius: '8px',
                marginBottom: '16px',
                color: '#0c4a6e',
                fontSize: '14px'
              }}>
                {uploadProgress}
              </div>
            )}

            {useStreaming && processingInfo.totalChunks && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: '#6b7280' }}>進捗</span>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: '#111827' }}>
                    {processingInfo.currentChunk || 0} / {processingInfo.totalChunks}
                  </span>
                </div>
                <div style={{ width: '100%', backgroundColor: '#e5e7eb', borderRadius: '9999px', height: '8px' }}>
                  <div
                    style={{
                      backgroundColor: '#2563eb',
                      height: '8px',
                      borderRadius: '9999px',
                      transition: 'all 0.3s',
                      width: `${((processingInfo.currentChunk || 0) / processingInfo.totalChunks) * 100}%`
                    }}
                  ></div>
                </div>
              </div>
            )}

            {liveTranscript && (
              <div style={{
                backgroundColor: '#ffffff',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '16px',
                maxHeight: '400px',
                overflowY: 'auto'
              }}>
                <pre style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  margin: 0,
                  color: '#1f2937',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                }}>
                  {liveTranscript}
                </pre>
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{
            marginTop: '16px',
            padding: '16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" style={{ marginRight: '8px' }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
              <span style={{ color: '#dc2626', fontSize: '14px' }}>{error}</span>
            </div>
          </div>
        )}
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: 'none'
        }}
      />
    </div>
  );
}
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "音声テキスト化アプリ",
  description: "音声ファイルをアップロードしてテキストに変換するアプリケーション",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-gray-50">
        <header className="bg-blue-600 text-white p-4 shadow-lg">
          <div className="container mx-auto">
            <h1 className="text-2xl font-bold">音声テキスト化アプリ</h1>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          {children}
        </main>

        <footer className="bg-gray-800 text-white p-4 text-center mt-auto">
          <div className="container mx-auto">
            &copy; {new Date().getFullYear()} 音声テキスト化アプリ
          </div>
        </footer>
      </body>
    </html>
  );
}
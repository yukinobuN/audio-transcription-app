import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "音声要約アプリ",
  description: "音声ファイルをアップロードしてテキストに変換するアプリケーション",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        {children}
      </body>
    </html>
  );
}
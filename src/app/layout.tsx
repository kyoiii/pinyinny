import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pinyinny — Chinese to Pinyin Converter",
  description: "Convert Chinese characters to pinyin with tones",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

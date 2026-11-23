import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Geist_Mono } from 'next/font/google';
import './globals.css';

// Self-hosted (Fontshare, ITF Free Font License) so visitors make no third-party font request.
// Cabinet Grotesk sets every head; Ranade is the quieter text face; Gambarino is the one serif figure.
const cabinet = localFont({
  src: [{ path: './fonts/CabinetGrotesk-Bold.woff2', weight: '700', style: 'normal' }],
  variable: '--font-cabinet',
  display: 'swap',
});
const ranade = localFont({
  src: [
    { path: './fonts/Ranade-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Ranade-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-ranade',
  display: 'swap',
});
const gambarino = localFont({
  src: [{ path: './fonts/Gambarino-Regular.woff2', weight: '400', style: 'normal' }],
  variable: '--font-gambarino',
  display: 'swap',
});
const geistMono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'GemClean: Gemini Watermark Remover',
  description: 'Remove visible Gemini, Veo, and Google Flow corner marks and hidden metadata locally in your browser.',
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${cabinet.variable} ${ranade.variable} ${gambarino.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

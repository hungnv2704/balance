import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Balance — Quản lý Tài chính Cá nhân',
  description:
    'Balance — Ứng dụng quản lý thu nhập, chi tiêu, chuyển khoản nội bộ, ngân sách và dòng tiền đa ví.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-[#F8FAFC] text-[#0F172A] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

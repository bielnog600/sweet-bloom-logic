import './globals.css';

export const metadata = {
  title: 'WhatsApp SaaS',
  description: 'Plataforma de atendimento WhatsApp',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

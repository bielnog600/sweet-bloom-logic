import './globals.css';
import Navbar from '../components/Navbar';

export const metadata = {
  title: 'WhatsApp SaaS',
  description: 'Plataforma de atendimento WhatsApp',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Navbar />
        {children}
      </body>
    </html>
  );
}

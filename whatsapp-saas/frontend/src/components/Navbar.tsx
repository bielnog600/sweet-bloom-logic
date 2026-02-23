'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/inbox', label: '📥 Inbox', description: 'Conversas' },
  { href: '/whatsapp', label: '📱 WhatsApp', description: 'Instâncias' },
  { href: '/automations', label: '🤖 Automações', description: 'Fluxos automáticos' },
  { href: '/scheduling', label: '📅 Agendamento', description: 'Mensagens agendadas' },
  { href: '/settings', label: '⚙️ Configurações', description: 'Sistema' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '8px 16px',
      borderBottom: '1px solid #e5e7eb',
      background: '#fff',
    }}>
      <Link
        href="/"
        style={{
          fontWeight: 700,
          fontSize: '18px',
          marginRight: '24px',
          color: '#25D366',
          textDecoration: 'none',
        }}
      >
        WhatsApp SaaS
      </Link>

      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: isActive ? 600 : 400,
              background: isActive ? '#ecfdf5' : 'transparent',
              color: isActive ? '#059669' : '#374151',
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
            title={item.description}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

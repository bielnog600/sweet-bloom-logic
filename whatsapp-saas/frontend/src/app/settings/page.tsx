'use client';

export default function SettingsPage() {
  return (
    <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>⚙️ Configurações</h1>
      <p style={{ color: '#6b7280', marginBottom: '24px' }}>
        Gerencie seu tenant, usuários, planos e preferências do sistema.
      </p>

      <div style={{ display: 'grid', gap: '16px' }}>
        {[
          { title: '👤 Perfil', desc: 'Altere seu nome, email e senha' },
          { title: '👥 Usuários', desc: 'Gerencie agentes e permissões' },
          { title: '📋 Plano', desc: 'Veja seu plano atual e limites' },
          { title: '🔑 API Keys', desc: 'Gerencie chaves de integração' },
          { title: '🔔 Notificações', desc: 'Configure alertas e avisos' },
        ].map((item) => (
          <div key={item.title} style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '16px',
          }}>
            <p style={{ fontWeight: 600, marginBottom: '4px' }}>{item.title}</p>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

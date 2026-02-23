'use client';

export default function AutomationsPage() {
  return (
    <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>🤖 Automações</h1>
      <p style={{ color: '#6b7280', marginBottom: '24px' }}>
        Configure fluxos automáticos para responder mensagens, encaminhar conversas e mais.
      </p>

      <div style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '24px',
        textAlign: 'center',
        color: '#9ca3af',
      }}>
        <p style={{ fontSize: '48px', marginBottom: '8px' }}>🚧</p>
        <p style={{ fontWeight: 600 }}>Em breve</p>
        <p>Automações de mensagens, respostas automáticas, chatbots e fluxos inteligentes.</p>
      </div>
    </div>
  );
}

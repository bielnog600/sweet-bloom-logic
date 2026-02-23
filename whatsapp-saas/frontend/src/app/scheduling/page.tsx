'use client';

export default function SchedulingPage() {
  return (
    <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>📅 Agendamento</h1>
      <p style={{ color: '#6b7280', marginBottom: '24px' }}>
        Agende mensagens para serem enviadas em horários específicos.
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
        <p>Agendamento de mensagens, campanhas e envios em massa.</p>
      </div>
    </div>
  );
}

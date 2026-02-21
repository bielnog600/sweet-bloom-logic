'use client';

import { useEffect, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, useSocket } from '@/lib/api';
import { Smartphone, Wifi, WifiOff, RefreshCw, Trash2, Plus } from 'lucide-react';

interface Instance {
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: string;
  live_status: string;
  last_connected_at: string | null;
}

export default function WhatsAppPage() {
  const [token] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('token') : null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);

  const { socket } = useSocket(token);

  const loadInstances = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/api/whatsapp/instances', {}, token);
      setInstances(data.instances);
    } catch (err) {
      console.error(err);
    }
  }, [token]);

  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  // WebSocket events
  useEffect(() => {
    if (!socket) return;

    socket.on('whatsapp:qr', ({ instanceId, qr }: { instanceId: string; qr: string }) => {
      setQrCodes((prev) => ({ ...prev, [instanceId]: qr }));
    });

    socket.on('whatsapp:connected', ({ instanceId }: { instanceId: string }) => {
      setQrCodes((prev) => {
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
      loadInstances();
    });

    socket.on('whatsapp:disconnected', () => {
      loadInstances();
    });

    return () => {
      socket.off('whatsapp:qr');
      socket.off('whatsapp:connected');
      socket.off('whatsapp:disconnected');
    };
  }, [socket, loadInstances]);

  const createInstance = async () => {
    if (!newName.trim() || !token) return;
    setLoading(true);
    try {
      await api('/api/whatsapp/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: newName }),
      }, token);
      setNewName('');
      await loadInstances();
    } catch (err: any) {
      alert(err.message);
    }
    setLoading(false);
  };

  const connectInstance = async (instanceId: string) => {
    if (!token) return;
    try {
      await api(`/api/whatsapp/instances/${instanceId}/connect`, { method: 'POST' }, token);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const disconnectInstance = async (instanceId: string, logout = false) => {
    if (!token) return;
    try {
      await api(`/api/whatsapp/instances/${instanceId}/disconnect`, {
        method: 'POST',
        body: JSON.stringify({ logout }),
      }, token);
      await loadInstances();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      connected: 'bg-green-100 text-green-800',
      connecting: 'bg-yellow-100 text-yellow-800',
      qr_pending: 'bg-blue-100 text-blue-800',
      disconnected: 'bg-red-100 text-red-800',
      expired: 'bg-gray-100 text-gray-800',
    };
    const labels: Record<string, string> = {
      connected: 'Conectado',
      connecting: 'Conectando...',
      qr_pending: 'Aguardando QR',
      disconnected: 'Desconectado',
      expired: 'Expirado',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.disconnected}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <Smartphone className="w-6 h-6" />
          Conexões WhatsApp
        </h1>

        {/* Criar nova instância */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex gap-3">
          <input
            type="text"
            placeholder="Nome da instância (ex: Vendas, Suporte)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && createInstance()}
          />
          <button
            onClick={createInstance}
            disabled={loading || !newName.trim()}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>

        {/* Lista de instâncias */}
        <div className="space-y-4">
          {instances.map((instance) => (
            <div key={instance.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{instance.instance_name}</h3>
                  {instance.phone_number && (
                    <p className="text-sm text-gray-500">+{instance.phone_number}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(instance.live_status || instance.status)}

                  {instance.live_status !== 'connected' && (
                    <button
                      onClick={() => connectInstance(instance.id)}
                      className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Gerar QR
                    </button>
                  )}

                  {instance.live_status === 'connected' && (
                    <button
                      onClick={() => disconnectInstance(instance.id)}
                      className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300 flex items-center gap-1"
                    >
                      <WifiOff className="w-3 h-3" /> Desconectar
                    </button>
                  )}

                  <button
                    onClick={() => disconnectInstance(instance.id, true)}
                    className="text-red-500 hover:text-red-700 p-1.5"
                    title="Deslogar (remove sessão)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* QR Code */}
              {qrCodes[instance.id] && (
                <div className="flex flex-col items-center py-6 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-4">Escaneie o QR Code no WhatsApp do seu celular</p>
                  <QRCodeSVG value={qrCodes[instance.id]} size={256} />
                  <p className="text-xs text-gray-400 mt-3">O QR expira em ~60 segundos</p>
                </div>
              )}

              {instance.last_connected_at && (
                <p className="text-xs text-gray-400 mt-2">
                  Última conexão: {new Date(instance.last_connected_at).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          ))}

          {instances.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nenhuma instância WhatsApp configurada</p>
              <p className="text-sm">Crie uma instância acima para começar</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

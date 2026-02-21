'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api, useSocket } from '@/lib/api';
import { MessageCircle, User, Send, Check, CheckCheck, Clock, Image, Paperclip, Lock } from 'lucide-react';

interface Conversation {
  id: string;
  contact_name: string;
  contact_phone: string;
  push_name: string;
  last_message_preview: string;
  last_message_at: string;
  unread_count: number;
  status: string;
  assigned_name: string | null;
  instance_name: string;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string;
  status: string;
  sender_name: string | null;
  is_from_ai: boolean;
  created_at: string;
}

export default function InboxPage() {
  const [token] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('token') : null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { socket } = useSocket(token);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    const params = filter !== 'all' ? `?status=${filter}` : '';
    const data = await api(`/api/inbox/conversations${params}`, {}, token);
    setConversations(data.conversations);
  }, [token, filter]);

  const loadMessages = useCallback(async (convId: string) => {
    if (!token) return;
    const data = await api(`/api/inbox/conversations/${convId}/messages`, {}, token);
    setMessages(data.messages);
  }, [token]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (selectedConv) {
      loadMessages(selectedConv.id);
      socket?.emit('join_conversation', selectedConv.id);
    }
    return () => {
      if (selectedConv) socket?.emit('leave_conversation', selectedConv.id);
    };
  }, [selectedConv, loadMessages, socket]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Real-time messages
  useEffect(() => {
    if (!socket) return;
    socket.on('whatsapp:message', (data: any) => {
      // Refresh conversations list
      loadConversations();
      // If we're viewing this conversation, add message
      if (selectedConv) {
        loadMessages(selectedConv.id);
      }
    });
    return () => { socket.off('whatsapp:message'); };
  }, [socket, selectedConv, loadConversations, loadMessages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConv || !token) return;
    try {
      // Get instance info from conversation
      await api('/api/whatsapp/send/text', {
        method: 'POST',
        body: JSON.stringify({
          instance_id: (selectedConv as any).instance_id,
          to: (selectedConv as any).contact_phone?.replace(/\D/g, '') + '@s.whatsapp.net',
          text: newMessage,
        }),
      }, token);
      setNewMessage('');
      setTimeout(() => loadMessages(selectedConv.id), 500);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const assignConversation = async (convId: string) => {
    if (!token) return;
    try {
      await api(`/api/inbox/conversations/${convId}/assign`, { method: 'POST' }, token);
      loadConversations();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const resolveConversation = async (convId: string) => {
    if (!token) return;
    await api(`/api/inbox/conversations/${convId}/resolve`, { method: 'POST' }, token);
    loadConversations();
    setSelectedConv(null);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent': return <Check className="w-3 h-3 text-gray-400" />;
      case 'delivered': return <CheckCheck className="w-3 h-3 text-gray-400" />;
      case 'read': return <CheckCheck className="w-3 h-3 text-blue-500" />;
      case 'pending': return <Clock className="w-3 h-3 text-gray-300" />;
      default: return null;
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar: Conversations */}
      <div className="w-96 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <MessageCircle className="w-5 h-5" /> Inbox
          </h2>
          <div className="flex gap-1 mt-3">
            {['all', 'open', 'in_progress', 'resolved'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  filter === f ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f === 'all' ? 'Todas' : f === 'open' ? 'Abertas' : f === 'in_progress' ? 'Em atendimento' : 'Resolvidas'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => setSelectedConv(conv)}
              className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
                selectedConv?.id === conv.id ? 'bg-green-50 border-l-4 border-l-green-500' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-gray-500" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{conv.push_name || conv.contact_name || conv.contact_phone}</p>
                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{conv.last_message_preview}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">
                    {conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </p>
                  {conv.unread_count > 0 && (
                    <span className="bg-green-500 text-white text-xs rounded-full px-2 py-0.5">
                      {conv.unread_count}
                    </span>
                  )}
                </div>
              </div>
              {conv.assigned_name && (
                <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> {conv.assigned_name}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="bg-white p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-gray-500" />
                </div>
                <div>
                  <p className="font-medium">{selectedConv.push_name || selectedConv.contact_name}</p>
                  <p className="text-xs text-gray-500">{selectedConv.contact_phone} • {selectedConv.instance_name}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => assignConversation(selectedConv.id)}
                  className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded text-sm hover:bg-blue-200"
                >
                  Assumir
                </button>
                <button
                  onClick={() => resolveConversation(selectedConv.id)}
                  className="bg-green-100 text-green-700 px-3 py-1.5 rounded text-sm hover:bg-green-200"
                >
                  ✓ Resolver
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#e5ddd5]">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-3 py-2 shadow-sm ${
                      msg.direction === 'outbound'
                        ? 'bg-[#dcf8c6]'
                        : 'bg-white'
                    }`}
                  >
                    {msg.is_from_ai && (
                      <p className="text-xs text-purple-500 font-medium mb-1">🤖 IA</p>
                    )}
                    {msg.sender_name && msg.direction === 'outbound' && (
                      <p className="text-xs text-blue-600 font-medium">{msg.sender_name}</p>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[10px] text-gray-500">
                        {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {msg.direction === 'outbound' && getStatusIcon(msg.status)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="bg-white p-3 border-t flex gap-2">
              <button className="text-gray-400 hover:text-gray-600 p-2">
                <Paperclip className="w-5 h-5" />
              </button>
              <button className="text-gray-400 hover:text-gray-600 p-2">
                <Image className="w-5 h-5" />
              </button>
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Digite uma mensagem..."
                className="flex-1 border rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={sendMessage}
                disabled={!newMessage.trim()}
                className="bg-green-600 text-white p-2 rounded-full hover:bg-green-700 disabled:opacity-50"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg">Selecione uma conversa</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

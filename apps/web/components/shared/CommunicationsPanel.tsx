'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare, Plus, Send, Users, User, ArrowLeft, Loader2, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

interface Props {
  role: 'STUDENT' | 'EVALUATOR' | 'ADMIN';
  currentUserId: string;
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export function CommunicationsPanel({ role, currentUserId }: Props) {
  const searchParams = useSearchParams();
  const [chats, setChats] = useState<any[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');
  const [creatingChat, setCreatingChat] = useState(false);
  const [newChatMode, setNewChatMode] = useState<'DIRECT' | 'GROUP'>('DIRECT');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [chatTab, setChatTab] = useState<'all' | 'direct' | 'group'>('all');
  const [reactionTarget, setReactionTarget] = useState<string | null>(null); // ts of hovered message
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  // Poll chats every 5s
  useEffect(() => {
    const load = () =>
      api.messages.chats.list()
        .then((res: any) => { setChats((res as any).data ?? []); setLoadingChats(false); })
        .catch(() => setLoadingChats(false));
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  // Deep-link: open chat from ?chatId= query param
  useEffect(() => {
    const chatId = searchParams.get('chatId');
    if (chatId && !selectedChatId) setSelectedChatId(chatId);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll messages of selected chat every 5s
  useEffect(() => {
    if (!selectedChatId) return;
    setLoadingMessages(true);
    const load = () =>
      api.messages.get(selectedChatId)
        .then((res: any) => {
          setMessages((res as any).data?.messages ?? []);
          setLoadingMessages(false);
        })
        .catch(() => setLoadingMessages(false));
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [selectedChatId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setMessages([]);
    // Update local unread to 0 immediately
    setChats((prev) => prev.map((c) => c.chatId === chatId ? { ...c, unread: 0 } : c));
  };

  const sendMessage = async () => {
    if (!text.trim() || !selectedChatId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const optimistic = {
      chatId: selectedChatId,
      senderId: currentUserId,
      senderName: 'Tú',
      text: text.trim(),
      createdAt: new Date().toISOString(),
      ts: `optimistic_${Date.now()}`,
    };
    setMessages((prev) => [...prev, optimistic]);
    setText('');
    try {
      await api.messages.send(selectedChatId, optimistic.text);
    } catch {
      setMessages((prev) => prev.filter((m) => m.ts !== optimistic.ts));
      setText(optimistic.text);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const openNewChat = async () => {
    setNewChatOpen(true);
    setNewChatSearch('');
    setNewChatMode('DIRECT');
    setSelectedCourse('');
    setLoadingContacts(true);
    try {
      // /messages/contacts devuelve evaluadores para estudiantes, estudiantes para evaluadores/admins
      const contactsRes = await api.messages.contacts();
      setContacts((contactsRes as any).data ?? []);

      if (role !== 'STUDENT') {
        const coursesRes = await api.admin.courses.list();
        setCourses((coursesRes as any).data ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoadingContacts(false); }
  };

  const startDirectChat = async (targetUserId: string) => {
    if (creatingChat) return;
    setCreatingChat(true);
    try {
      const res = await api.messages.chats.create({ type: 'DIRECT', targetUserId });
      const chatId = (res as any).data?.chatId;
      setNewChatOpen(false);
      if (chatId) selectChat(chatId);
      // Refresh chats
      const chatsRes = await api.messages.chats.list();
      setChats((chatsRes as any).data ?? []);
    } catch { /* ignore */ }
    finally { setCreatingChat(false); }
  };

  const startGroupChat = async () => {
    if (creatingChat || !selectedCourse) return;
    const course = courses.find((c: any) => c.id === selectedCourse);
    if (!course) return;
    setCreatingChat(true);
    try {
      // Get enrolled students for this course from evaluator endpoint
      const studentsRes = await api.evaluator.students();
      const students: any[] = (studentsRes as any).data?.students ?? [];
      const enrolled = students
        .filter((s: any) => s.courses?.some((c: any) => c.courseId === selectedCourse))
        .map((s: any) => s.userId);

      const res = await api.messages.chats.create({
        type: 'GROUP',
        courseId: selectedCourse,
        name: course.title,
        participantIds: enrolled,
      });
      const chatId = (res as any).data?.chatId;
      setNewChatOpen(false);
      if (chatId) selectChat(chatId);
      const chatsRes = await api.messages.chats.list();
      setChats((chatsRes as any).data ?? []);
    } catch { /* ignore */ }
    finally { setCreatingChat(false); }
  };

  const filteredContacts = contacts.filter((c: any) => {
    const q = newChatSearch.toLowerCase();
    return !q || (c.name ?? '').toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  const selectedChat = chats.find((c) => c.chatId === selectedChatId);
  const totalUnread = chats.reduce((s, c) => s + (c.unread ?? 0), 0);

  const filteredChats = chats.filter((c) => {
    if (chatTab === 'direct') return c.chatId?.startsWith('direct_');
    if (chatTab === 'group') return c.chatId?.startsWith('group_');
    return true;
  });

  const handleReact = async (ts: string, emoji: string) => {
    if (!selectedChatId) return;
    // Optimistic update
    setMessages((prev) => prev.map((m) => {
      if (m.ts !== ts) return m;
      const reactions = { ...(m.reactions ?? {}) };
      const users: string[] = reactions[emoji] ?? [];
      if (users.includes(currentUserId)) {
        reactions[emoji] = users.filter((u) => u !== currentUserId);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji] = [...users, currentUserId];
      }
      return { ...m, reactions };
    }));
    await api.messages.react(selectedChatId, ts, emoji).catch(() => {});
    setReactionTarget(null);
  };

  // Mobile: show list or chat (toggle)
  const [mobileShowMessages, setMobileShowMessages] = useState(false);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-cta-from" />
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">Comunicaciones</h1>
            {totalUnread > 0 && (
              <p className="text-xs text-cta-from font-semibold">{totalUnread} mensaje{totalUnread !== 1 ? 's' : ''} sin leer</p>
            )}
          </div>
        </div>
        <Button size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={openNewChat}>
          Nuevo chat
        </Button>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Chat list — hidden on mobile when a chat is selected */}
        <div className={`${mobileShowMessages && selectedChatId ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-72 shrink-0`}>
          <div className="card flex-1 flex flex-col p-0 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-border">
              {(['all', 'direct', 'group'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setChatTab(tab)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    chatTab === tab ? 'text-cta-from border-b-2 border-cta-from' : 'text-gray-400 hover:text-charcoal'
                  }`}
                >
                  {tab === 'all' ? 'Todos' : tab === 'direct' ? 'Directos' : 'Grupos'}
                </button>
              ))}
            </div>
            {loadingChats ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((n) => <div key={n} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <MessageSquare className="w-10 h-10 text-gray-200 mb-3" />
                <p className="text-sm text-gray-400 font-medium">Sin conversaciones</p>
                <p className="text-xs text-gray-400 mt-1">Inicia un chat con el botón "Nuevo chat"</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1">
                {filteredChats.map((chat) => {
                  const isActive = chat.chatId === selectedChatId;
                  return (
                    <button
                      key={chat.chatId}
                      onClick={() => { selectChat(chat.chatId); setMobileShowMessages(true); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 border-b border-border text-left transition-colors ${
                        isActive ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-surface'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${
                        chat.chatType === 'GROUP' ? 'bg-purple-500' : 'bg-cta-gradient'
                      }`}>
                        {chat.chatType === 'GROUP'
                          ? <Users className="w-5 h-5" />
                          : (chat.chatName?.[0] ?? '?').toUpperCase()
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-charcoal text-sm truncate">{chat.chatName ?? chat.chatId}</p>
                          <span className="text-xs text-gray-400 shrink-0 ml-1">{timeAgo(chat.lastTs)}</span>
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{chat.lastMessage ?? 'Sin mensajes'}</p>
                      </div>
                      {(chat.unread ?? 0) > 0 && (
                        <span className="bg-cta-from text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                          {chat.unread > 9 ? '9+' : chat.unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Messages panel */}
        <div className={`${mobileShowMessages ? 'flex' : 'hidden lg:flex'} flex-1 flex-col min-w-0`}>
          {!selectedChatId ? (
            <div className="card flex-1 flex flex-col items-center justify-center text-center h-full">
              <MessageSquare className="w-12 h-12 text-gray-200 mb-3" />
              <p className="font-heading font-semibold text-charcoal">Selecciona una conversación</p>
              <p className="text-sm text-gray-400 mt-1">O inicia una nueva con el botón "Nuevo chat"</p>
            </div>
          ) : (
            <div className="card flex flex-col h-full p-0 overflow-hidden">
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                <button
                  onClick={() => setMobileShowMessages(false)}
                  className="lg:hidden p-1.5 rounded-lg hover:bg-surface transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 text-gray-500" />
                </button>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${
                  selectedChat?.chatType === 'GROUP' ? 'bg-purple-500' : 'bg-cta-gradient'
                }`}>
                  {selectedChat?.chatType === 'GROUP'
                    ? <Users className="w-4 h-4" />
                    : (selectedChat?.chatName?.[0] ?? '?').toUpperCase()
                  }
                </div>
                <div>
                  <p className="font-semibold text-charcoal text-sm">{selectedChat?.chatName ?? selectedChatId}</p>
                  <p className="text-xs text-gray-400">
                    {selectedChat?.chatType === 'GROUP' ? 'Chat grupal' : 'Chat directo'}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMessages && messages.length === 0 ? (
                  <div className="flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-8">
                    <p>No hay mensajes todavía.</p>
                    <p className="text-xs mt-1">¡Sé el primero en escribir!</p>
                  </div>
                ) : (
                  messages.map((msg, i) => {
                    const isMe = msg.senderId === currentUserId;
                    const reactions: Record<string, string[]> = msg.reactions ?? {};
                    const isHovered = reactionTarget === msg.ts;
                    const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏'];
                    return (
                      <div
                        key={msg.ts ?? i}
                        className={`flex ${isMe ? 'justify-end' : 'justify-start'} group`}
                        onMouseEnter={() => setReactionTarget(msg.ts)}
                        onMouseLeave={() => setReactionTarget(null)}
                      >
                        <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                          {!isMe && (
                            <p className="text-xs text-gray-400 px-1">{msg.senderName}</p>
                          )}
                          <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                            isMe
                              ? 'bg-gradient-to-br from-cta-from to-cta-to text-white rounded-br-sm'
                              : 'bg-surface text-charcoal rounded-bl-sm border border-border'
                          } ${msg.ts?.startsWith('optimistic') ? 'opacity-60' : ''}`}>
                            {msg.text}
                          </div>

                          {/* Reactions display */}
                          {Object.keys(reactions).length > 0 && (
                            <div className="flex flex-wrap gap-1 px-1">
                              {Object.entries(reactions).map(([emoji, users]) =>
                                (users as string[]).length > 0 ? (
                                  <button
                                    key={emoji}
                                    onClick={() => handleReact(msg.ts, emoji)}
                                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                      (users as string[]).includes(currentUserId)
                                        ? 'bg-blue-100 border-blue-300 text-blue-700'
                                        : 'bg-white border-border text-gray-600 hover:bg-gray-50'
                                    }`}
                                  >
                                    {emoji} <span>{(users as string[]).length}</span>
                                  </button>
                                ) : null
                              )}
                            </div>
                          )}

                          <div className="flex items-center gap-1 px-1">
                            <p className="text-xs text-gray-400">{formatTime(msg.createdAt)}</p>
                            {/* Quick emoji picker on hover */}
                            {isHovered && !msg.ts?.startsWith('optimistic') && (
                              <div className="flex gap-0.5 bg-white border border-border rounded-full px-1.5 py-0.5 shadow-sm">
                                {QUICK_EMOJIS.map((e) => (
                                  <button
                                    key={e}
                                    onClick={() => handleReact(msg.ts, e)}
                                    className="w-6 h-6 flex items-center justify-center text-sm hover:bg-gray-100 rounded-full transition-colors"
                                  >
                                    {e}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="border-t border-border p-3 flex items-end gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder="Escribe un mensaje... (Enter para enviar)"
                  className="flex-1 input-field resize-none min-h-[40px] max-h-[120px] py-2 text-sm"
                  rows={1}
                />
                <button
                  onClick={sendMessage}
                  disabled={!text.trim() || sending}
                  className="w-10 h-10 rounded-xl bg-gradient-to-br from-cta-from to-cta-to text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Chat Modal */}
      <Modal open={newChatOpen} onClose={() => setNewChatOpen(false)} title="Nuevo chat" size="md">
        <div className="space-y-4">
          {/* Mode toggle (evaluator/admin only) */}
          {role !== 'STUDENT' && (
            <div className="flex bg-surface rounded-xl p-1 gap-1">
              {(['DIRECT', 'GROUP'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setNewChatMode(m)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${
                    newChatMode === m ? 'bg-white shadow-sm text-charcoal' : 'text-gray-500 hover:text-charcoal'
                  }`}
                >
                  {m === 'DIRECT' ? <User className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                  {m === 'DIRECT' ? 'Chat directo' : 'Grupo de curso'}
                </button>
              ))}
            </div>
          )}

          {/* DIRECT: contact list */}
          {newChatMode === 'DIRECT' && (
            <>
              <Input
                placeholder={role === 'STUDENT' ? 'Buscar evaluador...' : 'Buscar estudiante...'}
                value={newChatSearch}
                onChange={(e) => setNewChatSearch(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />}
              />
              {loadingContacts ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => <div key={n} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
                </div>
              ) : filteredContacts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No se encontraron contactos</p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {filteredContacts.map((c: any) => (
                    <button
                      key={c.username}
                      onClick={() => startDirectChat(c.username)}
                      disabled={creatingChat}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface transition-colors text-left disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {(c.name || c.email)[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-charcoal text-sm truncate">{c.name || c.email}</p>
                        {c.name && <p className="text-xs text-gray-400 truncate">{c.email}</p>}
                      </div>
                      {creatingChat && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* GROUP: course selector */}
          {newChatMode === 'GROUP' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">Crea un chat grupal para todos los estudiantes inscritos en un curso.</p>
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                className="input-field"
              >
                <option value="">— Selecciona un curso —</option>
                {courses.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <Button
                onClick={startGroupChat}
                loading={creatingChat}
                disabled={!selectedCourse}
                className="w-full"
                leftIcon={<Users className="w-4 h-4" />}
              >
                Crear grupo
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

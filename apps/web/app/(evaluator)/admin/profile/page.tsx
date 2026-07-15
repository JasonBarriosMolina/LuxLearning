'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck, User, Mail, Upload, Edit2, Save, Phone, FileText,
  AlertTriangle, Check, Users, BookOpen, Link2, Plus, X, Trash2, Briefcase,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useLanguage } from '@/lib/i18n';
import { useAuth } from '@/lib/hooks/useAuth';

interface ProfileData {
  username: string;
  name: string;
  email: string;
  picture: string;
  phone: string;
  bio: string;
  title: string;
  specialty: string;
  experience: string;
  socialLinks: { platform: string; url: string }[];
}

const SOCIAL_PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/tu-perfil' },
  { id: 'github', label: 'GitHub', placeholder: 'https://github.com/tu-usuario' },
  { id: 'portfolio', label: 'Portafolio', placeholder: 'https://tu-portafolio.com' },
  { id: 'twitter', label: 'Twitter / X', placeholder: 'https://twitter.com/tu-usuario' },
  { id: 'other', label: 'Otro', placeholder: 'https://...' },
];

function isValidUrl(url: string) {
  try { new URL(url); return true; } catch { return false; }
}

function InfoRow({ icon, label, value, empty }: { icon: React.ReactNode; label: string; value?: string; empty: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-sm text-charcoal mt-0.5">{value ? value : <span className="italic text-gray-400">{empty}</span>}</p>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 p-4 bg-surface rounded-xl">
      <div className="w-9 h-9 rounded-xl bg-white border border-border flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-charcoal">{value}</p>
      </div>
    </div>
  );
}

export default function AdminProfilePage() {
  const { t } = useLanguage();
  const { role, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [courseCount, setCourseCount] = useState<number | null>(null);

  // Photo upload
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photoDragging, setPhotoDragging] = useState(false);

  // Basic info
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicForm, setBasicForm] = useState({ name: '', phone: '', bio: '' });
  const [basicSaving, setBasicSaving] = useState(false);
  const [basicError, setBasicError] = useState('');

  // Professional info
  const [editingPro, setEditingPro] = useState(false);
  const [proForm, setProForm] = useState({ title: '', specialty: '', experience: '' });
  const [proSaving, setProSaving] = useState(false);
  const [proError, setProError] = useState('');

  // Social links
  const [socialLinks, setSocialLinks] = useState<{ platform: string; url: string }[]>([]);
  const [addingLink, setAddingLink] = useState(false);
  const [newLink, setNewLink] = useState({ platform: 'linkedin', url: '' });
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState('');

  // Toast
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    if (!authLoading && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      router.replace('/evaluator/profile');
      return;
    }
  }, [authLoading, role, router]);

  useEffect(() => {
    api.profile.get().then((res: any) => {
      const p: ProfileData = res.data;
      setProfile(p);
      setBasicForm({ name: p.name, phone: p.phone ?? '', bio: p.bio ?? '' });
      setProForm({ title: p.title ?? '', specialty: p.specialty ?? '', experience: p.experience ?? '' });
      setSocialLinks(p.socialLinks ?? []);
    }).catch(() => {}).finally(() => setLoading(false));

    api.admin.users.list().then((res: any) => {
      const users = res?.data?.users ?? res?.data ?? [];
      setUserCount(Array.isArray(users) ? users.length : null);
    }).catch(() => {});

    api.courses.list().then((res: any) => {
      const courses = res?.data ?? res ?? [];
      setCourseCount(Array.isArray(courses) ? courses.length : null);
    }).catch(() => {});
  }, []);

  // ── Photo upload ──────────────────────────────────────────────────────────
  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { setPhotoError('Solo se aceptan imágenes.'); return; }
    if (file.size > 5 * 1024 * 1024) { setPhotoError('La imagen no puede superar 5 MB.'); return; }
    setPhotoLoading(true); setPhotoError('');
    try {
      const presignRes = await api.admin.files.presign({ fileName: file.name, fileType: file.type, folder: 'photos' });
      const { uploadUrl, publicUrl } = (presignRes as any).data;
      const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);
      await api.profile.update({ picture: publicUrl });
      setProfile((p) => p ? { ...p, picture: publicUrl } : p);
      showToast('Foto actualizada correctamente.');
    } catch { setPhotoError('Error al subir la foto. Intenta de nuevo.'); }
    finally { setPhotoLoading(false); }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadPhoto(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setPhotoDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadPhoto(file);
  };

  // ── Basic info ────────────────────────────────────────────────────────────
  const handleBasicSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBasicSaving(true); setBasicError('');
    try {
      await api.profile.update({ name: basicForm.name, phone: basicForm.phone, bio: basicForm.bio });
      setProfile((p) => p ? { ...p, ...basicForm } : p);
      setEditingBasic(false);
      showToast('Información actualizada.');
    } catch (err: any) { setBasicError(err?.message ?? 'Error al guardar.'); }
    finally { setBasicSaving(false); }
  };

  // ── Professional info ─────────────────────────────────────────────────────
  const handleProSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProSaving(true); setProError('');
    try {
      await api.profile.update({ title: proForm.title, specialty: proForm.specialty, experience: proForm.experience });
      setProfile((p) => p ? { ...p, ...proForm } : p);
      setEditingPro(false);
      showToast('Información profesional actualizada.');
    } catch (err: any) { setProError(err?.message ?? 'Error al guardar.'); }
    finally { setProSaving(false); }
  };

  // ── Social links ──────────────────────────────────────────────────────────
  const handleAddLink = async () => {
    if (!newLink.url.trim()) { setLinkError('La URL es requerida.'); return; }
    if (!isValidUrl(newLink.url)) { setLinkError('URL inválida.'); return; }
    setLinkSaving(true); setLinkError('');
    try {
      const updated = [...socialLinks, { platform: newLink.platform, url: newLink.url.trim() }];
      await api.profile.update({ socialLinks: updated });
      setSocialLinks(updated);
      setProfile((p) => p ? { ...p, socialLinks: updated } : p);
      setAddingLink(false);
      setNewLink({ platform: 'linkedin', url: '' });
      showToast('Red social agregada.');
    } catch { setLinkError('Error al guardar.'); }
    finally { setLinkSaving(false); }
  };

  const handleDeleteLink = async (idx: number) => {
    const updated = socialLinks.filter((_, i) => i !== idx);
    try {
      await api.profile.update({ socialLinks: updated });
      setSocialLinks(updated);
      setProfile((p) => p ? { ...p, socialLinks: updated } : p);
      showToast('Red social eliminada.');
    } catch { /* ignore */ }
  };

  if (authLoading || (role !== 'ADMIN' && role !== 'SUPER_ADMIN')) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-cta-from border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (loading) return (
    <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      {[1, 2, 3].map((i) => <div key={i} className="card h-32" />)}
    </div>
  );

  if (!profile) return null;

  const hasPhoto = !!profile.picture && profile.picture.startsWith('http');
  const initials = (profile.name || profile.email)[0]?.toUpperCase() ?? 'A';

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-6 h-6 text-cta-from" />
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Mi perfil</h1>
          <p className="text-sm text-gray-500">Administrador de la plataforma</p>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={<Users className="w-4 h-4 text-cta-from" />} label="Usuarios totales" value={userCount ?? '—'} />
        <StatCard icon={<BookOpen className="w-4 h-4 text-amber-600" />} label="Cursos activos" value={courseCount ?? '—'} />
      </div>

      {/* ── Header: avatar + info ── */}
      <div className="card">
        <div className="flex items-center gap-5">
          <div
            ref={dropRef}
            onDragOver={(e) => { e.preventDefault(); setPhotoDragging(true); }}
            onDragLeave={() => setPhotoDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`relative w-20 h-20 rounded-full shrink-0 cursor-pointer group transition-all
              ${photoDragging ? 'ring-4 ring-cta-from ring-offset-2' : ''}`}
          >
            {hasPhoto
              ? <img src={profile.picture} alt={profile.name} className="w-full h-full rounded-full object-cover" />
              : <div className="w-full h-full rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-2xl">{initials}</div>
            }
            <div className={`absolute inset-0 rounded-full bg-black/40 flex items-center justify-center transition-opacity
              ${photoLoading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {photoLoading
                ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Upload className="w-5 h-5 text-white" />
              }
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFilePick} />

          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-lg text-charcoal truncate">{profile.name || 'Sin nombre'}</p>
            <div className="flex items-center gap-1.5 text-sm text-gray-400 mt-0.5">
              <Mail className="w-3.5 h-3.5" /><span className="truncate">{profile.email}</span>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 mt-1 inline-block">
              {role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
            </span>
          </div>
        </div>
        {photoError && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />{photoError}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3 flex items-center gap-1">
          <Upload className="w-3 h-3" /> Haz clic o arrastra una imagen para cambiar tu foto
        </p>
      </div>

      {/* ── Información básica ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <User className="w-4 h-4 text-cta-from" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-charcoal">Información personal</h2>
              <p className="text-xs text-gray-500">Nombre, teléfono y biografía</p>
            </div>
          </div>
          {!editingBasic && (
            <Button variant="secondary" size="sm" leftIcon={<Edit2 className="w-3.5 h-3.5" />} onClick={() => setEditingBasic(true)}>Editar</Button>
          )}
        </div>

        {editingBasic ? (
          <form onSubmit={handleBasicSave} className="space-y-3">
            <Input label="Nombre completo" value={basicForm.name} onChange={(e) => setBasicForm((f) => ({ ...f, name: e.target.value }))} placeholder="Tu nombre" leftIcon={<User className="w-4 h-4" />} />
            <Input label="Teléfono" value={basicForm.phone} onChange={(e) => setBasicForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+57 300 000 0000" leftIcon={<Phone className="w-4 h-4" />} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Biografía</label>
              <textarea value={basicForm.bio} onChange={(e) => setBasicForm((f) => ({ ...f, bio: e.target.value }))}
                placeholder="Cuéntanos algo sobre ti..." className="input-field min-h-[80px] resize-y" maxLength={300} />
              <p className="text-xs text-gray-400 text-right">{basicForm.bio.length}/300</p>
            </div>
            {basicError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{basicError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => { setEditingBasic(false); setBasicForm({ name: profile.name, phone: profile.phone ?? '', bio: profile.bio ?? '' }); }}>Cancelar</Button>
              <Button type="submit" size="sm" loading={basicSaving} leftIcon={<Save className="w-4 h-4" />}>Guardar</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <InfoRow icon={<Phone className="w-4 h-4 text-gray-400" />} label="Teléfono" value={profile.phone} empty="Sin teléfono" />
            <InfoRow icon={<FileText className="w-4 h-4 text-gray-400" />} label="Biografía" value={profile.bio} empty="Sin biografía" />
          </div>
        )}
      </div>

      {/* ── Información profesional ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-charcoal">Información profesional</h2>
              <p className="text-xs text-gray-500">Título, especialidad y experiencia</p>
            </div>
          </div>
          {!editingPro && (
            <Button variant="secondary" size="sm" leftIcon={<Edit2 className="w-3.5 h-3.5" />} onClick={() => setEditingPro(true)}>Editar</Button>
          )}
        </div>

        {editingPro ? (
          <form onSubmit={handleProSave} className="space-y-3">
            <Input label="Título profesional" value={proForm.title} onChange={(e) => setProForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ej: Director de Tecnología" leftIcon={<Briefcase className="w-4 h-4" />} />
            <Input label="Especialidad" value={proForm.specialty} onChange={(e) => setProForm((f) => ({ ...f, specialty: e.target.value }))} placeholder="Ej: EdTech, Administración, etc." />
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Experiencia</label>
              <textarea value={proForm.experience} onChange={(e) => setProForm((f) => ({ ...f, experience: e.target.value }))}
                placeholder="Describe tu experiencia..." className="input-field min-h-[80px] resize-y" maxLength={500} />
              <p className="text-xs text-gray-400 text-right">{proForm.experience.length}/500</p>
            </div>
            {proError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{proError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => { setEditingPro(false); setProForm({ title: profile.title ?? '', specialty: profile.specialty ?? '', experience: profile.experience ?? '' }); }}>Cancelar</Button>
              <Button type="submit" size="sm" loading={proSaving} leftIcon={<Save className="w-4 h-4" />}>Guardar</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <InfoRow icon={<Briefcase className="w-4 h-4 text-gray-400" />} label="Título" value={profile.title} empty="Sin título" />
            <InfoRow icon={<Briefcase className="w-4 h-4 text-gray-400" />} label="Especialidad" value={profile.specialty} empty="Sin especialidad" />
            <InfoRow icon={<FileText className="w-4 h-4 text-gray-400" />} label="Experiencia" value={profile.experience} empty="Sin experiencia" />
          </div>
        )}
      </div>

      {/* ── Redes sociales ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
              <Link2 className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-charcoal">Redes sociales</h2>
              <p className="text-xs text-gray-500">LinkedIn, GitHub, portafolio y más</p>
            </div>
          </div>
          {!addingLink && (
            <Button variant="secondary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setAddingLink(true)}>Agregar</Button>
          )}
        </div>

        <div className="space-y-2">
          {socialLinks.map((link, idx) => {
            const platform = SOCIAL_PLATFORMS.find((p) => p.id === link.platform);
            return (
              <div key={idx} className="flex items-center gap-3 p-3 bg-surface rounded-xl group">
                <Link2 className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-500">{platform?.label ?? link.platform}</p>
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm text-cta-from hover:underline truncate block">{link.url}</a>
                </div>
                <button onClick={() => handleDeleteLink(idx)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
          {socialLinks.length === 0 && !addingLink && (
            <p className="text-sm text-gray-400 italic">Aún no has agregado redes sociales.</p>
          )}
        </div>

        {addingLink && (
          <div className="mt-4 space-y-3 p-4 bg-surface rounded-xl border border-border">
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Plataforma</label>
              <select value={newLink.platform} onChange={(e) => setNewLink((l) => ({ ...l, platform: e.target.value }))} className="input-field">
                {SOCIAL_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <Input label="URL" value={newLink.url} onChange={(e) => setNewLink((l) => ({ ...l, url: e.target.value }))}
              placeholder={SOCIAL_PLATFORMS.find((p) => p.id === newLink.platform)?.placeholder} leftIcon={<Link2 className="w-4 h-4" />} />
            {linkError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{linkError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" leftIcon={<X className="w-4 h-4" />} onClick={() => { setAddingLink(false); setNewLink({ platform: 'linkedin', url: '' }); setLinkError(''); }}>Cancelar</Button>
              <Button type="button" size="sm" loading={linkSaving} leftIcon={<Plus className="w-4 h-4" />} onClick={handleAddLink}>Agregar</Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-fade-in z-50">
          <Check className="w-4 h-4" /> {toast}
        </div>
      )}
    </div>
  );
}

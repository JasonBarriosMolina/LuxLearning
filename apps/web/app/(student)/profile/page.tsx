'use client';

import { useState, useEffect, useRef } from 'react';
import {
  User, Lock, Check, AlertTriangle, Eye, EyeOff, Upload,
  GraduationCap, Link2, Plus, Trash2, Edit2, Save, X, Phone, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/hooks/useAuth';
import { changePassword } from '@/lib/auth';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

interface ProfileData {
  username: string;
  name: string;
  email: string;
  picture: string;
  phone: string;
  bio: string;
  university: string;
  career: string;
  semester: string;
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

export default function ProfilePage() {
  const { email, role } = useAuth();
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  // Photo upload
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photoDragging, setPhotoDragging] = useState(false);

  // Basic info edit
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicForm, setBasicForm] = useState({ name: '', phone: '', bio: '' });
  const [basicSaving, setBasicSaving] = useState(false);
  const [basicSaved, setBasicSaved] = useState(false);
  const [basicError, setBasicError] = useState('');

  // Academic info edit
  const [editingAcademic, setEditingAcademic] = useState(false);
  const [academicForm, setAcademicForm] = useState({ university: '', career: '', semester: '' });
  const [academicSaving, setAcademicSaving] = useState(false);
  const [academicSaved, setAcademicSaved] = useState(false);
  const [academicError, setAcademicError] = useState('');

  // Social links
  const [socialLinks, setSocialLinks] = useState<{ platform: string; url: string }[]>([]);
  const [addingLink, setAddingLink] = useState(false);
  const [newLink, setNewLink] = useState({ platform: 'linkedin', url: '' });
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState('');

  // Password
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSaved, setPwSaved] = useState(false);

  // Toast
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    api.profile.get().then((res: any) => {
      const p: ProfileData = res.data;
      setProfile(p);
      setBasicForm({ name: p.name, phone: p.phone, bio: p.bio });
      setAcademicForm({ university: p.university, career: p.career, semester: p.semester });
      setSocialLinks(p.socialLinks ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // ── Photo upload (S3 presign) ──────────────────────────────────────────────
  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { setPhotoError('Solo se aceptan imágenes.'); return; }
    if (file.size > 5 * 1024 * 1024) { setPhotoError('La imagen no puede superar 5 MB.'); return; }
    setPhotoLoading(true); setPhotoError('');
    try {
      const presignRes = await api.admin.files.presign({ fileName: file.name, fileType: file.type, folder: 'photos' });
      const { uploadUrl, publicUrl } = (presignRes as any).data;
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
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
      setBasicSaved(true); setTimeout(() => setBasicSaved(false), 3000);
      showToast('Información actualizada correctamente.');
    } catch (err: any) { setBasicError(err?.message ?? 'Error al guardar.'); }
    finally { setBasicSaving(false); }
  };

  // ── Academic info ─────────────────────────────────────────────────────────
  const handleAcademicSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setAcademicSaving(true); setAcademicError('');
    try {
      await api.profile.update({ university: academicForm.university, career: academicForm.career, semester: academicForm.semester });
      setProfile((p) => p ? { ...p, ...academicForm } : p);
      setEditingAcademic(false);
      setAcademicSaved(true); setTimeout(() => setAcademicSaved(false), 3000);
      showToast('Información académica actualizada.');
    } catch (err: any) { setAcademicError(err?.message ?? 'Error al guardar.'); }
    finally { setAcademicSaving(false); }
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

  // ── Password ──────────────────────────────────────────────────────────────
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setPwError('');
    if (pw.next.length < 8) { setPwError(t.studentProfile.passwordTooShort); return; }
    if (pw.next !== pw.confirm) { setPwError(t.studentProfile.passwordMismatch); return; }
    setPwSaving(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwOpen(false);
      setPwSaved(true); setTimeout(() => setPwSaved(false), 3000);
      showToast(t.studentProfile.changePasswordSaved);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('NotAuthorizedException') || msg.includes('Incorrect')) setPwError(t.studentProfile.errorWrongPassword);
      else if (msg.includes('InvalidPassword') || msg.includes('Password does not conform')) setPwError(t.studentProfile.errorInvalidPassword);
      else if (msg.includes('LimitExceeded') || msg.includes('TooManyRequests')) setPwError(t.studentProfile.errorTooManyAttempts);
      else setPwError(t.studentProfile.errorGenericPassword);
    } finally { setPwSaving(false); }
  };

  if (loading) return (
    <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      {[1, 2, 3].map((i) => <div key={i} className="card h-32" />)}
    </div>
  );

  const hasPhoto = !!profile?.picture && profile.picture.startsWith('http');
  const initials = (profile?.name || email || 'U')[0]?.toUpperCase() ?? 'U';
  const roleLabel = role === 'ADMIN' ? t.studentProfile.roleAdmin : role === 'EVALUATOR' ? t.studentProfile.roleEvaluator : t.studentProfile.roleStudent;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">{t.studentProfile.title}</h1>
        <p className="text-gray-500 mt-1 text-sm">{t.studentProfile.subtitle}</p>
      </div>

      {/* ── Header card: avatar + email + role ── */}
      <div className="card">
        <div className="flex items-center gap-5">
          {/* Avatar with drag & drop */}
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
              ? <img src={profile!.picture} alt={profile!.name} className="w-full h-full rounded-full object-cover" />
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
            <p className="font-heading font-bold text-lg text-charcoal truncate">{profile?.name || 'Sin nombre'}</p>
            <p className="text-sm text-gray-400 truncate">{email}</p>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface text-gray-500 mt-1 inline-block">{roleLabel}</span>
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
            <Button variant="secondary" size="sm" leftIcon={<Edit2 className="w-3.5 h-3.5" />} onClick={() => setEditingBasic(true)}>
              Editar
            </Button>
          )}
        </div>

        {editingBasic ? (
          <form onSubmit={handleBasicSave} className="space-y-3">
            <Input label="Nombre completo" value={basicForm.name} onChange={(e) => setBasicForm((f) => ({ ...f, name: e.target.value }))} placeholder="Tu nombre completo" leftIcon={<User className="w-4 h-4" />} />
            <Input label="Teléfono" value={basicForm.phone} onChange={(e) => setBasicForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+57 300 000 0000" leftIcon={<Phone className="w-4 h-4" />} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Biografía</label>
              <textarea value={basicForm.bio} onChange={(e) => setBasicForm((f) => ({ ...f, bio: e.target.value }))}
                placeholder="Cuéntanos algo sobre ti..." className="input-field min-h-[80px] resize-y" maxLength={300} />
              <p className="text-xs text-gray-400 text-right">{basicForm.bio.length}/300</p>
            </div>
            {basicError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{basicError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => { setEditingBasic(false); setBasicForm({ name: profile?.name ?? '', phone: profile?.phone ?? '', bio: profile?.bio ?? '' }); }}>Cancelar</Button>
              <Button type="submit" size="sm" loading={basicSaving} leftIcon={<Save className="w-4 h-4" />}>Guardar</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <InfoRow icon={<User className="w-4 h-4 text-gray-400" />} label="Nombre" value={profile?.name} empty="Sin nombre" />
            <InfoRow icon={<Phone className="w-4 h-4 text-gray-400" />} label="Teléfono" value={profile?.phone} empty="Sin teléfono" />
            <InfoRow icon={<FileText className="w-4 h-4 text-gray-400" />} label="Biografía" value={profile?.bio} empty="Sin biografía" />
          </div>
        )}
      </div>

      {/* ── Información académica ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
              <GraduationCap className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-charcoal">Información académica</h2>
              <p className="text-xs text-gray-500">Universidad, carrera y semestre</p>
            </div>
          </div>
          {!editingAcademic && (
            <Button variant="secondary" size="sm" leftIcon={<Edit2 className="w-3.5 h-3.5" />} onClick={() => setEditingAcademic(true)}>
              Editar
            </Button>
          )}
        </div>

        {editingAcademic ? (
          <form onSubmit={handleAcademicSave} className="space-y-3">
            <Input label="Universidad" value={academicForm.university} onChange={(e) => setAcademicForm((f) => ({ ...f, university: e.target.value }))} placeholder="Ej: Universidad Nacional" leftIcon={<GraduationCap className="w-4 h-4" />} />
            <Input label="Carrera" value={academicForm.career} onChange={(e) => setAcademicForm((f) => ({ ...f, career: e.target.value }))} placeholder="Ej: Ingeniería de Sistemas" />
            <Input label="Semestre" value={academicForm.semester} onChange={(e) => setAcademicForm((f) => ({ ...f, semester: e.target.value }))} placeholder="Ej: 6" />
            {academicError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{academicError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => { setEditingAcademic(false); setAcademicForm({ university: profile?.university ?? '', career: profile?.career ?? '', semester: profile?.semester ?? '' }); }}>Cancelar</Button>
              <Button type="submit" size="sm" loading={academicSaving} leftIcon={<Save className="w-4 h-4" />}>Guardar</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <InfoRow icon={<GraduationCap className="w-4 h-4 text-gray-400" />} label="Universidad" value={profile?.university} empty="Sin universidad" />
            <InfoRow icon={<GraduationCap className="w-4 h-4 text-gray-400" />} label="Carrera" value={profile?.career} empty="Sin carrera" />
            <InfoRow icon={<GraduationCap className="w-4 h-4 text-gray-400" />} label="Semestre" value={profile?.semester} empty="Sin semestre" />
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
            <Button variant="secondary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setAddingLink(true)}>
              Agregar
            </Button>
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
              <select value={newLink.platform} onChange={(e) => setNewLink((l) => ({ ...l, platform: e.target.value }))}
                className="input-field">
                {SOCIAL_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <Input
              label="URL"
              value={newLink.url}
              onChange={(e) => setNewLink((l) => ({ ...l, url: e.target.value }))}
              placeholder={SOCIAL_PLATFORMS.find((p) => p.id === newLink.platform)?.placeholder}
              leftIcon={<Link2 className="w-4 h-4" />}
            />
            {linkError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{linkError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" leftIcon={<X className="w-4 h-4" />} onClick={() => { setAddingLink(false); setNewLink({ platform: 'linkedin', url: '' }); setLinkError(''); }}>Cancelar</Button>
              <Button type="button" size="sm" loading={linkSaving} leftIcon={<Plus className="w-4 h-4" />} onClick={handleAddLink}>Agregar</Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Cambiar contraseña ── */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
              <Lock className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-charcoal">{t.studentProfile.changePasswordTitle}</h2>
              <p className="text-xs text-gray-500">{t.studentProfile.passwordHintFull}</p>
            </div>
          </div>
          {!pwOpen && (
            <Button variant="secondary" size="sm" onClick={() => setPwOpen(true)}>Cambiar</Button>
          )}
        </div>

        {pwOpen && (
          <form onSubmit={handleChangePassword} className="mt-4 space-y-3">
            <div className="relative">
              <Input label={t.studentProfile.currentPassword} type={showPw ? 'text' : 'password'} value={pw.current}
                onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} placeholder="••••••••" required leftIcon={<Lock className="w-4 h-4" />} />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-[38px] text-gray-400 hover:text-charcoal">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Input label={t.studentProfile.newPassword} type={showPw ? 'text' : 'password'} value={pw.next}
              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} placeholder={t.studentProfile.minCharsHint} required leftIcon={<Lock className="w-4 h-4" />} />
            <Input label={t.studentProfile.confirmPassword} type={showPw ? 'text' : 'password'} value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} placeholder={t.studentProfile.confirmPasswordPlaceholder} required leftIcon={<Lock className="w-4 h-4" />} />
            {pwError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{pwError}</div>}
            {pwSaved && <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700"><Check className="w-4 h-4 shrink-0" />{t.studentProfile.changePasswordSaved}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => { setPwOpen(false); setPw({ current: '', next: '', confirm: '' }); setPwError(''); }}>Cancelar</Button>
              <Button type="submit" size="sm" loading={pwSaving} leftIcon={<Lock className="w-4 h-4" />}>{t.studentProfile.changePasswordBtn}</Button>
            </div>
          </form>
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

function InfoRow({ icon, label, value, empty }: { icon: React.ReactNode; label: string; value?: string; empty: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-sm text-charcoal mt-0.5">
          {value ? value : <span className="italic text-gray-400">{empty}</span>}
        </p>
      </div>
    </div>
  );
}

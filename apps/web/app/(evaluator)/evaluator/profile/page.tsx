'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  UserCog, Save, Edit2, Mail, Phone, FileText, Lock, Eye, EyeOff,
  PenLine, Trash2, Check, AlertTriangle, Upload, Link2, Plus, X, Briefcase,
} from 'lucide-react';
import { api } from '@/lib/api';
import { changePassword } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useLanguage } from '@/lib/i18n';

// Dynamic import — react-signature-canvas uses document APIs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SignatureCanvas = dynamic(() => import('react-signature-canvas'), { ssr: false }) as any;

interface ProfileData {
  username: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  picture: string;
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
        <p className="text-sm text-charcoal mt-0.5">
          {value ? value : <span className="italic text-gray-400">{empty}</span>}
        </p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const sigCanvasRef = useRef<any>(null);

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
  const [basicError, setBasicError] = useState('');

  // Professional info edit
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

  // Digital signature
  const [sigMode, setSigMode] = useState(false);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [sigSaving, setSigSaving] = useState(false);

  // Password
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');

  // Toast
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    api.profile.get().then((res: any) => {
      const p: ProfileData = res.data;
      setProfile(p);
      setBasicForm({ name: p.name, phone: p.phone ?? '', bio: p.bio ?? '' });
      setProForm({ title: p.title ?? '', specialty: p.specialty ?? '', experience: p.experience ?? '' });
      setSocialLinks(p.socialLinks ?? []);
    }).catch(() => {}).finally(() => setLoading(false));

    api.evaluator.signature.get().then((res: any) => {
      if (res?.data?.signature) setSavedSignature(res.data.signature);
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
      showToast(t.evaluator.profileUpdated);
    } catch (err: any) { setBasicError(err?.message ?? t.evaluator.errorSave); }
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
    } catch (err: any) { setProError(err?.message ?? t.evaluator.errorSave); }
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

  // ── Signature ─────────────────────────────────────────────────────────────
  const handleSaveSignature = async () => {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    const dataUrl = sigCanvasRef.current.toDataURL('image/png');
    setSigSaving(true);
    try {
      await api.evaluator.signature.save(dataUrl);
      setSavedSignature(dataUrl);
      setSigMode(false);
      showToast(t.evaluator.signatureSaved);
    } catch { /* ignore */ } finally { setSigSaving(false); }
  };

  // ── Password ──────────────────────────────────────────────────────────────
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setPwError('');
    if (pw.next.length < 8) { setPwError(t.evaluator.passwordTooShort); return; }
    if (pw.next !== pw.confirm) { setPwError(t.evaluator.passwordMismatch); return; }
    setPwSaving(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwOpen(false);
      showToast(t.evaluator.passwordChanged);
    } catch (err: any) { setPwError(err.message ?? t.evaluator.errorPassword); }
    finally { setPwSaving(false); }
  };

  if (loading) return (
    <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      {[1, 2, 3].map((i) => <div key={i} className="card h-32" />)}
    </div>
  );

  if (!profile) return null;

  const hasPhoto = !!profile.picture && profile.picture.startsWith('http');
  const initials = (profile.name || profile.email)[0]?.toUpperCase() ?? '?';

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <UserCog className="w-6 h-6 text-cta-from" />
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">{t.evaluator.profileTitle}</h1>
          <p className="text-sm text-gray-500">{t.evaluator.profileSubtitle}</p>
        </div>
      </div>

      {/* ── Header: avatar + name ── */}
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
            <p className="font-heading font-bold text-lg text-charcoal truncate">{profile.name || t.evaluator.noName}</p>
            <div className="flex items-center gap-1.5 text-sm text-gray-400 mt-0.5">
              <Mail className="w-3.5 h-3.5" />
              <span className="truncate">{profile.email}</span>
            </div>
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
              <UserCog className="w-4 h-4 text-cta-from" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-charcoal">Información personal</h2>
              <p className="text-xs text-gray-500">Nombre, teléfono y biografía</p>
            </div>
          </div>
          {!editingBasic && (
            <Button variant="secondary" size="sm" leftIcon={<Edit2 className="w-3.5 h-3.5" />} onClick={() => setEditingBasic(true)}>
              {t.evaluator.editBtn}
            </Button>
          )}
        </div>

        {editingBasic ? (
          <form onSubmit={handleBasicSave} className="space-y-3">
            <Input label={t.evaluator.fullName} value={basicForm.name} onChange={(e) => setBasicForm((f) => ({ ...f, name: e.target.value }))} placeholder="Tu nombre" leftIcon={<UserCog className="w-4 h-4" />} />
            <Input label={t.evaluator.phoneLabel} value={basicForm.phone} onChange={(e) => setBasicForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+57 300 000 0000" leftIcon={<Phone className="w-4 h-4" />} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">{t.evaluator.bioLabel}</label>
              <textarea value={basicForm.bio} onChange={(e) => setBasicForm((f) => ({ ...f, bio: e.target.value }))}
                placeholder="Escribe una breve descripción sobre ti..." className="input-field min-h-[80px] resize-y" maxLength={300} />
              <p className="text-xs text-gray-400 text-right">{basicForm.bio.length}/300</p>
            </div>
            {basicError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{basicError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => { setEditingBasic(false); setBasicForm({ name: profile.name, phone: profile.phone ?? '', bio: profile.bio ?? '' }); }}>{t.evaluator.cancelBtn}</Button>
              <Button type="submit" size="sm" loading={basicSaving} leftIcon={<Save className="w-4 h-4" />}>{t.evaluator.saveChanges}</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <InfoRow icon={<Phone className="w-4 h-4 text-gray-400" />} label={t.evaluator.phoneLabel} value={profile.phone} empty={t.evaluator.noPhone} />
            <InfoRow icon={<FileText className="w-4 h-4 text-gray-400" />} label={t.evaluator.bioLabel} value={profile.bio} empty={t.evaluator.noBio} />
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
            <Button variant="secondary" size="sm" leftIcon={<Edit2 className="w-3.5 h-3.5" />} onClick={() => setEditingPro(true)}>
              {t.evaluator.editBtn}
            </Button>
          )}
        </div>

        {editingPro ? (
          <form onSubmit={handleProSave} className="space-y-3">
            <Input label="Título profesional" value={proForm.title} onChange={(e) => setProForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ej: Ingeniero de Software" leftIcon={<Briefcase className="w-4 h-4" />} />
            <Input label="Especialidad" value={proForm.specialty} onChange={(e) => setProForm((f) => ({ ...f, specialty: e.target.value }))} placeholder="Ej: Desarrollo web, IA, etc." />
            <div className="space-y-1">
              <label className="text-sm font-medium text-charcoal">Experiencia</label>
              <textarea value={proForm.experience} onChange={(e) => setProForm((f) => ({ ...f, experience: e.target.value }))}
                placeholder="Describe tu experiencia profesional..." className="input-field min-h-[80px] resize-y" maxLength={500} />
              <p className="text-xs text-gray-400 text-right">{proForm.experience.length}/500</p>
            </div>
            {proError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{proError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => { setEditingPro(false); setProForm({ title: profile.title ?? '', specialty: profile.specialty ?? '', experience: profile.experience ?? '' }); }}>{t.evaluator.cancelBtn}</Button>
              <Button type="submit" size="sm" loading={proSaving} leftIcon={<Save className="w-4 h-4" />}>{t.evaluator.saveChanges}</Button>
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

      {/* ── Firma digital ── */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PenLine className="w-4 h-4 text-gray-400" />
            <p className="text-sm font-medium text-charcoal">{t.evaluator.signatureTitle}</p>
          </div>
          {!sigMode && (
            <Button variant="secondary" size="sm" onClick={() => setSigMode(true)}>
              {savedSignature ? t.evaluator.updateSignature : t.evaluator.createSignature}
            </Button>
          )}
        </div>
        {!sigMode && savedSignature && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2">{t.evaluator.savedSignatureLabel}</p>
            <div className="border border-border rounded-lg p-2 bg-white inline-block">
              <img src={savedSignature} alt="Firma digital" className="max-h-20 object-contain" />
            </div>
          </div>
        )}
        {sigMode && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-gray-500">{t.evaluator.drawHint}</p>
            <div className="border-2 border-dashed border-border rounded-lg overflow-hidden bg-white">
              <SignatureCanvas ref={sigCanvasRef} penColor="black" canvasProps={{ width: 480, height: 150, className: 'w-full' }} />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => sigCanvasRef.current?.clear()}>{t.evaluator.clearSignatureBtn}</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setSigMode(false)}>{t.evaluator.cancelBtn}</Button>
              <Button type="button" size="sm" loading={sigSaving} leftIcon={<Save className="w-4 h-4" />} onClick={handleSaveSignature}>{t.evaluator.saveSignatureBtn}</Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Cambiar contraseña ── */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-gray-400" />
            <p className="text-sm font-medium text-charcoal">{t.evaluator.passwordLabel}</p>
          </div>
          {!pwOpen && (
            <Button variant="secondary" size="sm" onClick={() => setPwOpen(true)}>{t.evaluator.changePasswordTitle}</Button>
          )}
        </div>
        {pwOpen && (
          <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
            <div className="relative">
              <Input label={t.evaluator.currentPassword} type={showPw ? 'text' : 'password'} value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} placeholder="Tu contraseña actual" leftIcon={<Lock className="w-4 h-4" />} />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-[38px] text-gray-400 hover:text-charcoal">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Input label={t.evaluator.newPassword} type={showPw ? 'text' : 'password'} value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} placeholder="Mínimo 8 caracteres" leftIcon={<Lock className="w-4 h-4" />} />
            <Input label={t.evaluator.confirmPassword} type={showPw ? 'text' : 'password'} value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} placeholder="Repetir nueva contraseña" leftIcon={<Lock className="w-4 h-4" />} />
            {pwError && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0" />{pwError}</div>}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setPwOpen(false); setPw({ current: '', next: '', confirm: '' }); setPwError(''); }}>{t.evaluator.cancelBtn}</Button>
              <Button type="submit" loading={pwSaving} leftIcon={<Lock className="w-4 h-4" />}>{t.evaluator.updatePassword}</Button>
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

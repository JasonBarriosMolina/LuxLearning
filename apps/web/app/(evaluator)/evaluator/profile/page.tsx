'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { UserCog, Save, Edit2, Mail, Phone, FileText, Loader2, Lock, Eye, EyeOff, ImageIcon, PenLine, Trash2, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { changePassword } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

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
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile edit
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', bio: '', picture: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Digital signature
  const sigCanvasRef = useRef<any>(null);
  const [sigMode, setSigMode] = useState(false);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [sigSaving, setSigSaving] = useState(false);
  const [sigSaved, setSigSaved] = useState(false);

  // Password change
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSaved, setPwSaved] = useState(false);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    api.profile.get().then((res) => {
      const p: ProfileData = (res as any).data;
      setProfile(p);
      setForm({ name: p.name, phone: p.phone, bio: p.bio, picture: p.picture ?? '' });
      setLoading(false);
    }).catch(() => setLoading(false));
    // Load existing signature
    api.evaluator.signature.get().then((res: any) => {
      if (res?.data?.signature) setSavedSignature(res.data.signature);
    }).catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.profile.update({ name: form.name, phone: form.phone, bio: form.bio, picture: form.picture });
      setProfile((p) => p ? { ...p, ...form } : p);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSignature = async () => {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    const dataUrl = sigCanvasRef.current.toDataURL('image/png');
    setSigSaving(true);
    try {
      await api.evaluator.signature.save(dataUrl);
      setSavedSignature(dataUrl);
      setSigMode(false);
      setSigSaved(true);
      setTimeout(() => setSigSaved(false), 3000);
    } catch { /* ignore */ } finally {
      setSigSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (pw.next.length < 8) { setPwError('La nueva contraseña debe tener al menos 8 caracteres'); return; }
    if (pw.next !== pw.confirm) { setPwError('Las contraseñas no coinciden'); return; }
    setPwSaving(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwOpen(false);
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 3000);
    } catch (err: any) {
      setPwError(err.message ?? 'Error al cambiar la contraseña');
    } finally {
      setPwSaving(false);
    }
  };

  if (loading) return (
    <div className="max-w-lg mx-auto space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      <div className="card h-48" />
    </div>
  );

  if (!profile) return null;

  const hasPhoto = profile.picture && profile.picture.startsWith('http');
  const initials = (profile.name || profile.email)[0]?.toUpperCase() ?? '?';

  return (
    <div className="max-w-lg mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <UserCog className="w-6 h-6 text-cta-from" />
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Mi Perfil</h1>
          <p className="text-sm text-gray-500">Información de tu cuenta</p>
        </div>
      </div>

      {/* Avatar + name */}
      <div className="card flex items-center gap-5">
        <div className="w-16 h-16 rounded-full overflow-hidden bg-cta-gradient flex items-center justify-center text-white font-bold text-2xl shrink-0">
          {hasPhoto
            ? <img src={profile.picture} alt={profile.name} className="w-full h-full object-cover" />
            : initials
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-lg text-charcoal truncate">{profile.name || '(sin nombre)'}</p>
          <div className="flex items-center gap-1.5 text-sm text-gray-400 mt-0.5">
            <Mail className="w-3.5 h-3.5" />
            <span className="truncate">{profile.email}</span>
          </div>
        </div>
        {!editing && (
          <Button variant="secondary" size="sm" leftIcon={<Edit2 className="w-4 h-4" />} onClick={() => setEditing(true)}>
            Editar
          </Button>
        )}
      </div>

      {/* Edit form */}
      {editing ? (
        <form onSubmit={handleSave} className="card space-y-4">
          <Input
            label="Nombre completo"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Tu nombre"
          />
          <Input
            label="Teléfono"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+57 300 000 0000"
          />
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">Bio</label>
            <textarea
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              placeholder="Escribe una breve descripción sobre ti..."
              className="input-field min-h-[80px] resize-y"
              maxLength={300}
            />
            <p className="text-xs text-gray-400 text-right">{form.bio.length}/300</p>
          </div>
          {/* Photo URL */}
          <div className="space-y-2">
            <Input
              label="Foto de perfil (URL)"
              value={form.picture}
              onChange={(e) => setForm((f) => ({ ...f, picture: e.target.value }))}
              placeholder="https://ejemplo.com/mi-foto.jpg"
              leftIcon={<ImageIcon className="w-4 h-4" />}
            />
            {form.picture && form.picture.startsWith('http') && (
              <div className="flex items-center gap-3">
                <img
                  src={form.picture}
                  alt="Preview"
                  className="w-12 h-12 rounded-full object-cover border border-border"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <p className="text-xs text-gray-400">Vista previa</p>
              </div>
            )}
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => {
              setEditing(false);
              setForm({ name: profile.name, phone: profile.phone, bio: profile.bio, picture: profile.picture ?? '' });
            }}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} leftIcon={<Save className="w-4 h-4" />}>
              Guardar cambios
            </Button>
          </div>
        </form>
      ) : (
        <div className="card space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Phone className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Teléfono</p>
                <p className="text-sm text-charcoal mt-0.5">{profile.phone || <span className="italic text-gray-400">No especificado</span>}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Bio</p>
                <p className="text-sm text-charcoal mt-0.5 leading-relaxed">{profile.bio || <span className="italic text-gray-400">Sin bio</span>}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password change section */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-gray-400" />
            <p className="text-sm font-medium text-charcoal">Contraseña</p>
          </div>
          {!pwOpen && (
            <Button variant="secondary" size="sm" onClick={() => setPwOpen(true)}>
              Cambiar contraseña
            </Button>
          )}
        </div>

        {pwOpen && (
          <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
            <div className="relative">
              <Input
                label="Contraseña actual"
                type={showPw ? 'text' : 'password'}
                value={pw.current}
                onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                placeholder="Tu contraseña actual"
              />
            </div>
            <Input
              label="Nueva contraseña"
              type={showPw ? 'text' : 'password'}
              value={pw.next}
              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
              placeholder="Mínimo 8 caracteres"
            />
            <Input
              label="Confirmar nueva contraseña"
              type={showPw ? 'text' : 'password'}
              value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
              placeholder="Repetir nueva contraseña"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
            >
              {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showPw ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
            </button>
            {pwError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{pwError}</div>
            )}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setPwOpen(false); setPw({ current: '', next: '', confirm: '' }); setPwError(''); }}>
                Cancelar
              </Button>
              <Button type="submit" loading={pwSaving} leftIcon={<Lock className="w-4 h-4" />}>
                Actualizar contraseña
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Digital Signature section */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PenLine className="w-4 h-4 text-gray-400" />
            <p className="text-sm font-medium text-charcoal">Firma Digital</p>
          </div>
          {!sigMode && (
            <Button variant="secondary" size="sm" onClick={() => setSigMode(true)}>
              {savedSignature ? 'Actualizar firma' : 'Crear firma'}
            </Button>
          )}
        </div>

        {/* Show saved signature preview */}
        {!sigMode && savedSignature && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2">Firma guardada:</p>
            <div className="border border-border rounded-lg p-2 bg-white inline-block">
              <img src={savedSignature} alt="Firma digital" className="max-h-20 object-contain" />
            </div>
          </div>
        )}

        {/* Signature canvas */}
        {sigMode && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-gray-500">Dibuja tu firma en el recuadro:</p>
            <div className="border-2 border-dashed border-border rounded-lg overflow-hidden bg-white">
              <SignatureCanvas
                ref={sigCanvasRef}
                penColor="black"
                canvasProps={{ width: 480, height: 150, className: 'w-full' }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<Trash2 className="w-4 h-4" />}
                onClick={() => sigCanvasRef.current?.clear()}
              >
                Limpiar
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSigMode(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                loading={sigSaving}
                leftIcon={<Save className="w-4 h-4" />}
                onClick={handleSaveSignature}
              >
                Guardar firma
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Success toasts */}
      {saved && (
        <div className="fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-fade-in z-50">
          ✓ Perfil actualizado
        </div>
      )}
      {pwSaved && (
        <div className="fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-fade-in z-50">
          ✓ Contraseña actualizada
        </div>
      )}
      {sigSaved && (
        <div className="fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-fade-in z-50">
          ✓ Firma guardada
        </div>
      )}
    </div>
  );
}

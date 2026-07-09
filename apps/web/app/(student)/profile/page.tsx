'use client';

import { useState, useEffect } from 'react';
import { User, Lock, Check, AlertTriangle, Eye, EyeOff, ImageIcon, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/hooks/useAuth';
import { updateName, changePassword } from '@/lib/auth';
import { updateUserAttributes } from 'aws-amplify/auth';
import { useLanguage } from '@/lib/i18n';

const NAME_CHANGE_KEY = 'lux-name-change-count';

function getNameChangeCount(): number {
  try { return parseInt(localStorage.getItem(NAME_CHANGE_KEY) ?? '0', 10) || 0; } catch { return 0; }
}
function incrementNameChangeCount() {
  try { localStorage.setItem(NAME_CHANGE_KEY, String(getNameChangeCount() + 1)); } catch { /* ignore */ }
}

export default function ProfilePage() {
  const { email, role } = useAuth();
  const { t } = useLanguage();

  // Name form
  const [name, setName] = useState('');
  const [nameChangeCount, setNameChangeCount] = useState(0);
  const [nameLoading, setNameLoading] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState('');

  // Picture form
  const [picture, setPicture] = useState('');
  const [pictureLoading, setPictureLoading] = useState(false);
  const [pictureSuccess, setPictureSuccess] = useState(false);
  const [pictureError, setPictureError] = useState('');

  // Password form
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [pwdError, setPwdError] = useState('');

  useEffect(() => {
    setNameChangeCount(getNameChangeCount());
  }, []);

  const nameRestricted = nameChangeCount >= 1;

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || nameRestricted) return;
    setNameLoading(true); setNameError(''); setNameSuccess(false);
    try {
      await updateName(name.trim());
      incrementNameChangeCount();
      setNameChangeCount(getNameChangeCount());
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 3000);
    } catch (err: any) {
      setNameError(err?.message ?? t.studentProfile.errorUpdateName);
    } finally {
      setNameLoading(false);
    }
  };

  const handleUpdatePicture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picture.trim()) return;
    setPictureLoading(true); setPictureError(''); setPictureSuccess(false);
    try {
      await updateUserAttributes({ userAttributes: { picture: picture.trim() } });
      setPictureSuccess(true);
      setTimeout(() => setPictureSuccess(false), 3000);
    } catch (err: any) {
      setPictureError(err?.message ?? t.studentProfile.errorUpdatePhoto);
    } finally {
      setPictureLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd !== confirmPwd) { setPwdError(t.studentProfile.passwordMismatch); return; }
    if (newPwd.length < 8) { setPwdError(t.studentProfile.passwordTooShort); return; }
    setPwdLoading(true); setPwdError(''); setPwdSuccess(false);
    try {
      await changePassword(oldPwd, newPwd);
      setPwdSuccess(true);
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      setTimeout(() => setPwdSuccess(false), 4000);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('NotAuthorizedException') || msg.includes('Incorrect')) {
        setPwdError(t.studentProfile.errorWrongPassword);
      } else if (msg.includes('InvalidPassword') || msg.includes('Password does not conform')) {
        setPwdError(t.studentProfile.errorInvalidPassword);
      } else if (msg.includes('LimitExceeded') || msg.includes('TooManyRequests')) {
        setPwdError(t.studentProfile.errorTooManyAttempts);
      } else {
        setPwdError(t.studentProfile.errorGenericPassword);
      }
    } finally {
      setPwdLoading(false);
    }
  };

  const isValidUrl = (url: string) => { try { new URL(url); return true; } catch { return false; } };
  const roleLabel = role === 'ADMIN' ? t.studentProfile.roleAdmin : role === 'EVALUATOR' ? t.studentProfile.roleEvaluator : t.studentProfile.roleStudent;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">{t.studentProfile.title}</h1>
        <p className="text-gray-500 mt-1 text-sm">{t.studentProfile.subtitle}</p>
      </div>

      {/* Account info */}
      <div className="card">
        <div className="flex items-center gap-4 mb-4">
          {picture && isValidUrl(picture) ? (
            <img src={picture} alt={t.studentProfile.photoSection} className="w-14 h-14 rounded-full object-cover shrink-0 border border-border" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-xl font-heading shrink-0">
              {email?.[0]?.toUpperCase() ?? 'U'}
            </div>
          )}
          <div>
            <p className="font-semibold text-charcoal">{email ?? 'usuario@ejemplo.com'}</p>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface text-gray-500">{roleLabel}</span>
          </div>
        </div>
        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Lock className="w-3 h-3" />
          {t.studentProfile.emailNote}
        </p>
      </div>

      {/* Photo URL */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-heading font-semibold text-charcoal">{t.studentProfile.photoSection}</h2>
            <p className="text-xs text-gray-500">{t.studentProfile.photoSubtitle}</p>
          </div>
        </div>
        <form onSubmit={handleUpdatePicture} className="space-y-3">
          <Input
            placeholder={t.studentProfile.photoPlaceholder}
            value={picture}
            onChange={(e) => setPicture(e.target.value)}
            leftIcon={<ImageIcon className="w-4 h-4" />}
            type="url"
          />
          {picture && isValidUrl(picture) && (
            <div className="flex items-center gap-3">
              <img src={picture} alt="Preview" className="w-12 h-12 rounded-full object-cover border border-border" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <p className="text-xs text-gray-400">{t.studentProfile.photoPreview}</p>
            </div>
          )}
          {pictureError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />{pictureError}
            </div>
          )}
          {pictureSuccess && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
              <Check className="w-4 h-4 shrink-0" />{t.studentProfile.photoSaved}
            </div>
          )}
          <Button type="submit" loading={pictureLoading} size="sm" disabled={!picture.trim()}>
            {t.studentProfile.savePhoto}
          </Button>
        </form>
      </div>

      {/* Update name */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <User className="w-4 h-4 text-cta-from" />
          </div>
          <div>
            <h2 className="font-heading font-semibold text-charcoal">{t.studentProfile.nameSection}</h2>
            <p className="text-xs text-gray-500">{t.studentProfile.nameSubtitle}</p>
          </div>
        </div>
        {nameRestricted ? (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t.studentProfile.nameRestriction}</span>
          </div>
        ) : (
          <form onSubmit={handleUpdateName} className="space-y-3">
            <Input
              placeholder={t.studentProfile.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              leftIcon={<User className="w-4 h-4" />}
            />
            {nameError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />{nameError}
              </div>
            )}
            {nameSuccess && (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
                <Check className="w-4 h-4 shrink-0" />{t.studentProfile.nameSaved}
              </div>
            )}
            <Button type="submit" loading={nameLoading} size="sm" disabled={!name.trim()}>
              {t.studentProfile.saveName}
            </Button>
          </form>
        )}
      </div>

      {/* Change password */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
            <Lock className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <h2 className="font-heading font-semibold text-charcoal">{t.studentProfile.changePasswordTitle}</h2>
            <p className="text-xs text-gray-500">{t.studentProfile.passwordHintFull}</p>
          </div>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div className="relative">
            <Input
              label={t.studentProfile.currentPassword}
              type={showOld ? 'text' : 'password'}
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              placeholder="••••••••"
              required
              leftIcon={<Lock className="w-4 h-4" />}
            />
            <button type="button" onClick={() => setShowOld(!showOld)}
              className="absolute right-3 top-[38px] text-gray-400 hover:text-charcoal">
              {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="relative">
            <Input
              label={t.studentProfile.newPassword}
              type={showNew ? 'text' : 'password'}
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder={t.studentProfile.minCharsHint}
              required
              leftIcon={<Lock className="w-4 h-4" />}
            />
            <button type="button" onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-[38px] text-gray-400 hover:text-charcoal">
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Input
            label={t.studentProfile.confirmPassword}
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder={t.studentProfile.confirmPasswordPlaceholder}
            required
            leftIcon={<Lock className="w-4 h-4" />}
          />
          {pwdError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />{pwdError}
            </div>
          )}
          {pwdSuccess && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
              <Check className="w-4 h-4 shrink-0" />{t.studentProfile.changePasswordSaved}
            </div>
          )}
          <Button type="submit" loading={pwdLoading} size="sm" disabled={!oldPwd || !newPwd || !confirmPwd}>
            {t.studentProfile.changePasswordBtn}
          </Button>
        </form>
      </div>
    </div>
  );
}

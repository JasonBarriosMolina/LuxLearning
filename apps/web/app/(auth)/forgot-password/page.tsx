'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, KeyRound, ArrowLeft, CheckCircle } from 'lucide-react';
import { PrismaLogo } from '@/components/shared/PrismaLogo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { forgotPassword, confirmForgotPassword } from '@/lib/auth';

type Step = 'email' | 'code' | 'done';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const translateError = (msg: string) => {
    if (msg.includes('UserNotFoundException')) return 'No existe una cuenta con ese correo electrónico.';
    if (msg.includes('LimitExceeded') || msg.includes('TooManyRequests')) return 'Demasiados intentos. Por favor espera unos minutos.';
    if (msg.includes('CodeMismatch') || msg.includes('Invalid verification code')) return 'El código es incorrecto. Verifica e intenta de nuevo.';
    if (msg.includes('ExpiredCode')) return 'El código expiró. Por favor solicita uno nuevo.';
    if (msg.includes('InvalidPassword') || msg.includes('Password does not conform')) return 'La contraseña debe tener al menos 8 caracteres, mayúsculas, minúsculas y números.';
    if (msg.includes('NetworkError') || msg.includes('network')) return 'Error de conexión. Verifica tu internet.';
    return 'Ocurrió un error. Por favor intenta de nuevo.';
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setStep('code');
    } catch (err: unknown) {
      setError(translateError(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
    if (newPassword.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    setError('');
    setLoading(true);
    try {
      await confirmForgotPassword(email.trim(), code.trim(), newPassword);
      setStep('done');
    } catch (err: unknown) {
      setError(translateError(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-charcoal flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-cta-from/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cta-to/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-8">
          <PrismaLogo size={40} />
        </div>

        <div className="bg-white rounded-2xl shadow-card-hover p-8">

          {/* Done */}
          {step === 'done' && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <h1 className="font-heading font-bold text-2xl text-charcoal">¡Contraseña actualizada!</h1>
              <p className="text-gray-500 text-sm">Ya puedes ingresar con tu nueva contraseña.</p>
              <Button className="w-full" onClick={() => router.push('/login')}>
                Ir al inicio de sesión
              </Button>
            </div>
          )}

          {/* Step 1: Enter email */}
          {step === 'email' && (
            <>
              <div className="mb-6">
                <Link href="/login" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-charcoal mb-4">
                  <ArrowLeft className="w-4 h-4" /> Volver
                </Link>
                <div className="w-12 h-12 rounded-xl bg-cta-gradient flex items-center justify-center mb-4">
                  <KeyRound className="w-6 h-6 text-white" />
                </div>
                <h1 className="font-heading font-bold text-2xl text-charcoal">¿Olvidaste tu contraseña?</h1>
                <p className="text-gray-500 mt-1 text-sm">
                  Ingresa tu correo y te enviaremos un código para restablecerla.
                </p>
              </div>
              <form onSubmit={handleSendCode} className="space-y-4">
                <Input
                  label="Correo electrónico"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  required
                  autoFocus
                  leftIcon={<Mail className="w-4 h-4" />}
                />
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
                )}
                <Button type="submit" loading={loading} className="w-full">
                  Enviar código
                </Button>
              </form>
            </>
          )}

          {/* Step 2: Enter code + new password */}
          {step === 'code' && (
            <>
              <div className="mb-6">
                <button onClick={() => setStep('email')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-charcoal mb-4">
                  <ArrowLeft className="w-4 h-4" /> Cambiar correo
                </button>
                <h1 className="font-heading font-bold text-2xl text-charcoal">Ingresa el código</h1>
                <p className="text-gray-500 mt-1 text-sm">
                  Enviamos un código de verificación a <strong className="text-charcoal">{email}</strong>.
                  Revisa tu bandeja de entrada.
                </p>
              </div>
              <form onSubmit={handleReset} className="space-y-4">
                <Input
                  label="Código de verificación"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                />
                <Input
                  label="Nueva contraseña"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  required
                  leftIcon={<Lock className="w-4 h-4" />}
                />
                <Input
                  label="Confirmar contraseña"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la contraseña"
                  required
                  leftIcon={<Lock className="w-4 h-4" />}
                />
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
                )}
                <Button type="submit" loading={loading} className="w-full">
                  Restablecer contraseña
                </Button>
                <button
                  type="button"
                  onClick={() => { setError(''); handleSendCode({ preventDefault: () => {} } as any); }}
                  className="w-full text-center text-xs text-gray-500 hover:text-charcoal transition-colors"
                >
                  ¿No recibiste el código? Reenviar
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-white/30 text-xs mt-6">
          Claridad que transforma. &copy; {new Date().getFullYear()} Lux Learning
        </p>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, User, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { PrismaLogo } from '@/components/shared/PrismaLogo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { register, confirmRegistration, resendCode } from '@/lib/auth';

type Step = 'register' | 'confirm';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setLoading(true);
    try {
      await register(email, password, name);
      setStep('confirm');
    } catch (err: unknown) {
      // Amplify v6 expone el tipo de excepción en err.name, no en err.message
      const msg = err instanceof Error ? err.message : String(err);
      const name = (err as any)?.name ?? '';
      if (name === 'UsernameExistsException' || msg.includes('UsernameExistsException')) {
        setError('Este correo ya está registrado. Inicia sesión o recupera tu contraseña.');
      } else if (name === 'InvalidPasswordException' || msg.includes('InvalidPasswordException') || msg.includes('Password did not conform')) {
        setError('La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.');
      } else if (name === 'InvalidParameterException' || msg.includes('InvalidParameterException')) {
        setError('Por favor verifica que todos los campos sean válidos.');
      } else if (name === 'NotAuthorizedException' || msg.includes('NotAuthorizedException')) {
        setError('No tienes autorización para crear una cuenta. Solicita una invitación a tu evaluador.');
      } else if (name === 'NetworkError' || msg.includes('NetworkError') || msg.includes('network')) {
        setError('Error de conexión. Verifica tu internet e intenta de nuevo.');
      } else if (name === 'LimitExceededException' || name === 'TooManyRequestsException' || msg.includes('TooManyRequestsException') || msg.includes('LimitExceededException')) {
        setError('Demasiados intentos. Por favor espera unos minutos e intenta de nuevo.');
      } else {
        setError(`Error al crear la cuenta. ${msg || name || 'Por favor intenta de nuevo.'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmRegistration(email, code);
      router.push('/login?registered=1');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('CodeMismatchException')) {
        setError('Código incorrecto. Inténtalo de nuevo.');
      } else if (msg.includes('ExpiredCodeException')) {
        setError('El código ha expirado. Solicita uno nuevo.');
      } else if (msg.includes('TooManyFailedAttemptsException')) {
        setError('Demasiados intentos fallidos. Solicita un nuevo código.');
      } else {
        setError('Error al verificar el código. Por favor intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendCode(email);
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown((c) => {
          if (c <= 1) { clearInterval(interval); return 0; }
          return c - 1;
        });
      }, 1000);
    } catch (err: unknown) {
      setError('No se pudo reenviar el código.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-cta-from/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cta-to/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-8">
          <PrismaLogo size={40} />
        </div>

        <div className="bg-white rounded-2xl shadow-card-hover p-8">
          {step === 'register' ? (
            <>
              <div className="mb-6">
                <h1 className="font-heading font-bold text-2xl text-charcoal">Crear cuenta</h1>
                <p className="text-gray-500 mt-1 text-sm">Únete a Lux Learning hoy</p>
              </div>

              <form onSubmit={handleRegister} className="space-y-4">
                <Input
                  label="Nombre completo"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre"
                  autoComplete="name"
                  leftIcon={<User className="w-4 h-4" />}
                />
                <Input
                  label="Correo electrónico"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  required
                  autoComplete="email"
                  leftIcon={<Mail className="w-4 h-4" />}
                />
                <div className="relative">
                  <Input
                    label="Contraseña"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    required
                    autoComplete="new-password"
                    leftIcon={<Lock className="w-4 h-4" />}
                    hint="Debe incluir mayúsculas, minúsculas y números"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-[38px] text-gray-400 hover:text-charcoal"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Input
                  label="Confirmar contraseña"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite tu contraseña"
                  required
                  autoComplete="new-password"
                  leftIcon={<Lock className="w-4 h-4" />}
                />

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
                    {error}
                  </div>
                )}

                <Button type="submit" loading={loading} className="w-full">
                  Crear cuenta
                </Button>
              </form>

              <p className="text-center text-sm text-gray-500 mt-6">
                ¿Ya tienes cuenta?{' '}
                <Link href="/login" className="gradient-text font-semibold hover:opacity-80">
                  Inicia sesión
                </Link>
              </p>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
              </div>
              <div className="mb-6 text-center">
                <h1 className="font-heading font-bold text-2xl text-charcoal">Verifica tu correo</h1>
                <p className="text-gray-500 mt-2 text-sm">
                  Enviamos un código de verificación a<br />
                  <strong className="text-charcoal">{email}</strong>
                </p>
              </div>

              <form onSubmit={handleConfirm} className="space-y-4">
                <Input
                  label="Código de verificación"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                  maxLength={6}
                  className="text-center text-2xl tracking-widest font-mono"
                />

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
                    {error}
                  </div>
                )}

                <Button type="submit" loading={loading} className="w-full">
                  Verificar cuenta
                </Button>
              </form>

              <div className="text-center mt-4">
                <button
                  onClick={handleResend}
                  disabled={resendCooldown > 0}
                  className="text-sm text-gray-500 hover:text-charcoal disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resendCooldown > 0 ? `Reenviar en ${resendCooldown}s` : 'Reenviar código'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

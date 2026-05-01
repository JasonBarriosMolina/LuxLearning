'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Eye, EyeOff, KeyRound } from 'lucide-react';
import { PrismaLogo } from '@/components/shared/PrismaLogo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { login, completeNewPassword, getUserRole } from '@/lib/auth';

type Step = 'login' | 'new_password';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect');

  const [step, setStep] = useState<Step>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const translateError = (msg: string) => {
    if (msg.includes('UserNotConfirmedException')) return 'Por favor confirma tu correo electrónico antes de iniciar sesión.';
    if (msg.includes('NotAuthorizedException')) return 'Correo o contraseña incorrectos.';
    if (msg.includes('UserNotFoundException')) return 'No existe una cuenta con ese correo electrónico.';
    if (msg.includes('UserAlreadyAuthenticatedException') || msg.includes('There is already')) return 'Ya hay una sesión activa. Por favor recarga la página.';
    if (msg.includes('NetworkError') || msg.includes('network')) return 'Error de conexión. Verifica tu internet e intenta de nuevo.';
    if (msg.includes('TooManyRequests') || msg.includes('LimitExceeded')) return 'Demasiados intentos. Por favor espera unos minutos.';
    if (msg.includes('PasswordResetRequired')) return 'Debes restablecer tu contraseña. Revisa tu correo electrónico.';
    if (msg.includes('InvalidPasswordException') || msg.includes('Password does not conform')) return 'La contraseña debe tener al menos 8 caracteres, mayúsculas, minúsculas y números.';
    return 'Error al iniciar sesión. Por favor intenta de nuevo.';
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setStep('new_password');
        setLoading(false);
        return;
      }
      const role = await getUserRole();
      const destination = redirectTo ?? (role === 'EVALUATOR' || role === 'ADMIN' ? '/evaluator/dashboard' : '/dashboard');
      router.push(destination);
    } catch (err: unknown) {
      setError(translateError(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
    if (newPassword.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    setError('');
    setLoading(true);
    try {
      await completeNewPassword(newPassword);
      const role = await getUserRole();
      const destination = redirectTo ?? (role === 'EVALUATOR' || role === 'ADMIN' ? '/evaluator/dashboard' : '/dashboard');
      router.push(destination);
    } catch (err: unknown) {
      setError(translateError(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  };

  // ── New password required (invited user first login) ──────────────────────
  if (step === 'new_password') {
    return (
      <div className="bg-white rounded-2xl shadow-card-hover p-8">
        <div className="mb-6">
          <div className="w-12 h-12 rounded-xl bg-cta-gradient flex items-center justify-center mb-4">
            <KeyRound className="w-6 h-6 text-white" />
          </div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Crea tu contraseña</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Es tu primer inicio de sesión. Por favor elige una contraseña nueva.
          </p>
        </div>
        <form onSubmit={handleNewPassword} className="space-y-4">
          <div className="relative">
            <Input
              label="Nueva contraseña"
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              required
              leftIcon={<Lock className="w-4 h-4" />}
            />
            <button type="button" onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-[38px] text-gray-400 hover:text-charcoal">
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
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
            Guardar contraseña e ingresar
          </Button>
        </form>
      </div>
    );
  }

  // ── Normal login ──────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl shadow-card-hover p-8">
      <div className="mb-6">
        <h1 className="font-heading font-bold text-2xl text-charcoal">Bienvenido</h1>
        <p className="text-gray-500 mt-1 text-sm">Ingresa a tu cuenta de Lux Learning</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
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
            placeholder="••••••••"
            required
            autoComplete="current-password"
            leftIcon={<Lock className="w-4 h-4" />}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-[38px] text-gray-400 hover:text-charcoal transition-colors"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs text-cta-from font-semibold hover:opacity-80 transition-opacity">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Iniciar sesión
        </Button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        ¿No tienes cuenta?{' '}
        <Link href="/register" className="gradient-text font-semibold hover:opacity-80 transition-opacity">
          Regístrate
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
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
        <Suspense fallback={
          <div className="bg-white rounded-2xl shadow-card-hover p-8 flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-cta-from border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <LoginForm />
        </Suspense>
        <p className="text-center text-white/30 text-xs mt-6">
          Claridad que transforma. &copy; {new Date().getFullYear()} Lux Learning
        </p>
      </div>
    </div>
  );
}

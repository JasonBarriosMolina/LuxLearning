'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { PrismaLogo } from '@/components/shared/PrismaLogo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { login, getUserRole } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      const role = await getUserRole();
      router.push(role === 'EVALUATOR' ? '/evaluator/dashboard' : '/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesión';
      if (msg.includes('UserNotConfirmedException')) {
        setError('Por favor confirma tu correo antes de iniciar sesión.');
      } else if (msg.includes('NotAuthorizedException')) {
        setError('Correo o contraseña incorrectos.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-charcoal flex items-center justify-center p-4">
      {/* Background gradient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-cta-from/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cta-to/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <PrismaLogo size={40} />
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-card-hover p-8">
          <div className="mb-6">
            <h1 className="font-heading font-bold text-2xl text-charcoal">Bienvenido</h1>
            <p className="text-gray-500 mt-1 text-sm">Ingresa a tu cuenta de Lux Learning</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <Button
              type="submit"
              loading={loading}
              className="w-full"
            >
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

        <p className="text-center text-white/30 text-xs mt-6">
          Claridad que transforma. &copy; {new Date().getFullYear()} Lux Learning
        </p>
      </div>
    </div>
  );
}

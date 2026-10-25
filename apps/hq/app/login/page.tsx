'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { confirmSignIn, signIn, type SignInOutput } from 'aws-amplify/auth';
import { KeyRound, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { useAuth } from '@/lib/auth';

type Stage =
  | { kind: 'credentials' }
  | { kind: 'newPassword' }
  | { kind: 'totpSetup'; uri: string; secret: string }
  | { kind: 'totpCode' };

const PASSWORD_HINT = 'Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo.';

function messageFor(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAuthorizedException': return 'Correo o contraseña incorrectos.';
    case 'UserNotFoundException': return 'Correo o contraseña incorrectos.';
    case 'CodeMismatchException': return 'El código no coincide. Revisa tu app autenticadora y vuelve a intentarlo.';
    case 'EnableSoftwareTokenMFAException': return 'El código no coincide. Escanea el QR de nuevo y escribe el código actual.';
    case 'InvalidPasswordException': return `La contraseña no cumple los requisitos. ${PASSWORD_HINT}`;
    case 'LimitExceededException':
    case 'TooManyRequestsException': return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
    case 'UserAlreadyAuthenticatedException': return '';
    default: return 'No pudimos iniciar sesión. Inténtalo de nuevo.';
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { staff, loading, refresh } = useAuth();
  const [stage, setStage] = useState<Stage>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && staff) router.replace('/');
  }, [loading, staff, router]);

  const handleStep = async (out: SignInOutput) => {
    const step = out.nextStep;
    switch (step.signInStep) {
      case 'DONE':
        await refresh();
        router.replace('/');
        return;
      case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
        setStage({ kind: 'newPassword' });
        return;
      case 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP': {
        const details = step.totpSetupDetails;
        setStage({ kind: 'totpSetup', uri: details.getSetupUri('Lux HQ', email).toString(), secret: details.sharedSecret });
        return;
      }
      case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
        setStage({ kind: 'totpCode' });
        return;
      default:
        setError('Tu cuenta necesita un paso que esta consola no admite. Escríbele a un administrador.');
    }
  };

  const run = async (action: () => Promise<SignInOutput>) => {
    setBusy(true);
    setError('');
    try {
      await handleStep(await action());
    } catch (err) {
      const msg = messageFor(err);
      if (msg) setError(msg);
      else { await refresh(); router.replace('/'); }
    } finally {
      setBusy(false);
      setCode('');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (stage.kind === 'credentials') {
      if (!email.trim() || !password) return setError('Escribe tu correo y tu contraseña.');
      return run(() => signIn({ username: email.trim().toLowerCase(), password }));
    }
    if (stage.kind === 'newPassword') {
      if (newPassword.length < 12) return setError(PASSWORD_HINT);
      return run(() => confirmSignIn({ challengeResponse: newPassword }));
    }
    if (!/^\d{6}$/.test(code)) return setError('Escribe los 6 dígitos de tu app autenticadora.');
    return run(() => confirmSignIn({ challengeResponse: code }));
  };

  const titles: Record<Stage['kind'], { icon: typeof KeyRound; title: string; text: string }> = {
    credentials: { icon: KeyRound, title: 'Inicia sesión en Lux HQ', text: 'Consola interna del equipo de Lux Learning.' },
    newPassword: { icon: KeyRound, title: 'Crea tu contraseña', text: 'Es tu primer ingreso: reemplaza la contraseña temporal por una propia.' },
    totpSetup: { icon: Smartphone, title: 'Activa la verificación en dos pasos', text: 'Escanea el código con Google Authenticator, Microsoft Authenticator o 1Password.' },
    totpCode: { icon: ShieldCheck, title: 'Verificación en dos pasos', text: 'Escribe el código de 6 dígitos de tu app autenticadora.' },
  };
  const head = titles[stage.kind];
  const Icon = head.icon;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_60%_50%_at_80%_0%,rgba(47,143,219,0.18),transparent_70%),radial-gradient(ellipse_50%_50%_at_0%_100%,rgba(31,162,199,0.14),transparent_70%)] px-5 py-12">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-sm font-extrabold tracking-wide text-lux">
          Lux <span className="text-gold">HQ</span>
        </p>
        <form onSubmit={onSubmit} noValidate className="card p-8 shadow-[0_30px_70px_-35px_rgba(15,45,74,0.45)]">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#2F8FDB,#17527E)] text-white">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold tracking-[-0.02em] text-navy">{head.title}</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{head.text}</p>

          <div className="mt-7 space-y-4">
            {stage.kind === 'credentials' && (
              <>
                <label className="block text-sm font-bold text-navy">
                  Correo
                  <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                </label>
                <label className="block text-sm font-bold text-navy">
                  Contraseña
                  <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              </>
            )}

            {stage.kind === 'newPassword' && (
              <label className="block text-sm font-bold text-navy">
                Nueva contraseña
                <input className="field" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus />
                <span className="mt-1.5 block text-xs font-medium text-muted">{PASSWORD_HINT}</span>
              </label>
            )}

            {stage.kind === 'totpSetup' && (
              <div className="rounded-2xl bg-canvas p-5 text-center">
                <div className="mx-auto w-fit rounded-xl bg-white p-3 ring-1 ring-line">
                  <QRCodeSVG value={stage.uri} size={176} fgColor="#0F2D4A" />
                </div>
                <p className="mt-4 text-xs font-medium text-muted">¿No puedes escanear? Escribe esta clave en tu app:</p>
                <p className="mt-1 break-all font-mono text-sm font-bold text-navy">{stage.secret}</p>
              </div>
            )}

            {(stage.kind === 'totpSetup' || stage.kind === 'totpCode') && (
              <label className="block text-sm font-bold text-navy">
                Código de 6 dígitos
                <input
                  className="field text-center font-mono text-lg tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus={stage.kind === 'totpCode'}
                />
              </label>
            )}
          </div>

          {error && <p className="mt-4 rounded-xl bg-[#FEF3F2] px-4 py-3 text-sm font-medium text-[#B42318]" role="alert">{error}</p>}

          <button type="submit" disabled={busy} className="btn-primary mt-6 w-full py-3">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {stage.kind === 'credentials' ? 'Iniciar sesión' : stage.kind === 'newPassword' ? 'Guardar contraseña' : 'Verificar'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-soft">Acceso solo para el equipo de Lux Learning. Las cuentas las crea un administrador.</p>
      </div>
    </main>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AuthShell,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
  authLinkClass,
  authErrorClass,
  authSuccessClass,
} from '@/components/aurora/auth/AuthShell';
import { CheckCircle2, Loader2, Phone, Mail, ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

function VerifyPhoneInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const phoneFromQuery = searchParams?.get('phone') || '';

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [status, setStatus] = useState<'idle' | 'sending' | 'verifying' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [method, setMethod] = useState<'whatsapp' | 'email'>('email');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer(prev => prev - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const sendCode = useCallback(async (deliveryMethod: 'whatsapp' | 'email' = 'email') => {
    setStatus('sending');
    setMessage('');
    setDigits(Array(OTP_LENGTH).fill(''));

    try {
      const res = await fetch('/api/auth/send-phone-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneFromQuery || undefined,
          method: deliveryMethod,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus('error');
        setMessage(data.error || 'Error al enviar el código');
        return;
      }

      setMethod(data.method);
      setMaskedPhone(data.maskedPhone || '');
      setCodeSent(true);
      setResendTimer(RESEND_COOLDOWN);
      setStatus('idle');
      setMessage(
        data.method === 'whatsapp'
          ? 'Código enviado por WhatsApp'
          : 'Código enviado a tu correo electrónico'
      );

      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch {
      setStatus('error');
      setMessage('Error de conexión. Intenta de nuevo.');
    }
  }, [phoneFromQuery]);

  useEffect(() => {
    if (!codeSent && session) {
      sendCode('email');
    }
  }, [session, codeSent, sendCode]);

  const verifyCode = async (code: string) => {
    setStatus('verifying');
    setMessage('');

    try {
      const res = await fetch('/api/auth/verify-phone-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus('error');
        setMessage(data.error || 'Código incorrecto');
        setDigits(Array(OTP_LENGTH).fill(''));
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
        return;
      }

      setStatus('success');
      setMessage('Teléfono verificado exitosamente');
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1500);
    } catch {
      setStatus('error');
      setMessage('Error de conexión. Intenta de nuevo.');
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newDigits = [...digits];

    if (value.length > 1) {
      const pasted = value.slice(0, OTP_LENGTH).split('');
      for (let i = 0; i < OTP_LENGTH; i++) {
        newDigits[i] = pasted[i] || '';
      }
      setDigits(newDigits);
      if (pasted.length >= OTP_LENGTH) {
        verifyCode(newDigits.join(''));
      } else {
        inputRefs.current[pasted.length]?.focus();
      }
      return;
    }

    newDigits[index] = value;
    setDigits(newDigits);

    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (value && index === OTP_LENGTH - 1) {
      const code = newDigits.join('');
      if (code.length === OTP_LENGTH) {
        verifyCode(code);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  if (status === 'success') {
    return (
      <AuthShell
        brandPanel={false}
        icon={
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" aria-hidden />
          </span>
        }
        title="Teléfono Verificado"
        subtitle={message}
      >
        <div className="space-y-3 text-center">
          <p className="text-[13px] text-slate-500">Redirigiendo al dashboard...</p>
          <Link href="/dashboard" className={authPrimaryButtonClass}>
            Ir al Dashboard
          </Link>
        </div>
      </AuthShell>
    );
  }

  const actionsDisabled = resendTimer > 0 || status === 'sending' || status === 'verifying';

  return (
    <AuthShell
      brandPanel={false}
      icon={
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-au-tint-f1eeff text-au-ink-5b3fe0">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
      }
      title="Verifica tu Teléfono"
      subtitle={
        codeSent
          ? method === 'whatsapp'
            ? `Enviamos un código de 6 dígitos por WhatsApp a ${maskedPhone}`
            : `Enviamos un código de 6 dígitos a tu correo electrónico`
          : 'Enviando código de verificación...'
      }
    >
      <div className="space-y-6">
        {/* OTP Input */}
        <div className="flex justify-center gap-2 sm:gap-3">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={`Dígito ${i + 1}`}
              maxLength={i === 0 ? OTP_LENGTH : 1}
              value={digit}
              onChange={e => handleDigitChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              disabled={status === 'verifying' || status === 'sending'}
              className="h-14 w-11 rounded-xl border-2 border-slate-200 bg-white text-center text-2xl font-bold text-slate-900 outline-none transition-all focus:border-[#7C5CFF] focus:ring-2 focus:ring-[#7C5CFF]/20 disabled:opacity-50 sm:h-16 sm:w-12"
            />
          ))}
        </div>

        {/* Status messages */}
        {status === 'verifying' && (
          <div className="flex items-center justify-center gap-2 text-au-ink-5b3fe0">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[13px]">Verificando código...</span>
          </div>
        )}

        {status === 'sending' && (
          <div className="flex items-center justify-center gap-2 text-au-ink-5b3fe0">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[13px]">Enviando código...</span>
          </div>
        )}

        {message && status === 'error' && (
          <div className={`${authErrorClass} text-center`} role="alert">{message}</div>
        )}

        {message && status === 'idle' && codeSent && (
          <div className={`${authSuccessClass} text-center`}>{message}</div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <button
            type="button"
            className={authSecondaryButtonClass}
            disabled={actionsDisabled}
            onClick={() => sendCode(method)}
          >
            <RefreshCw className="h-4 w-4" />
            {resendTimer > 0
              ? `Reenviar código (${resendTimer}s)`
              : 'Reenviar código'}
          </button>

          {method === 'whatsapp' && (
            <button
              type="button"
              className={`${authLinkClass} flex w-full items-center justify-center gap-2 py-2 text-[13px] disabled:opacity-50`}
              disabled={actionsDisabled}
              onClick={() => sendCode('email')}
            >
              <Mail className="h-4 w-4" />
              Enviar por correo electrónico
            </button>
          )}
        </div>

        {/* Skip / Back */}
        <div className="border-t border-slate-100 pt-2 text-center">
          <Link href="/dashboard" className={`${authLinkClass} inline-flex items-center justify-center gap-1.5 py-2 text-[13px]`}>
            <ArrowLeft className="h-4 w-4" />
            Verificar después
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

export default function VerifyPhonePage() {
  return (
    <Suspense
      fallback={
        <AuthShell
          brandPanel={false}
          icon={<Loader2 className="h-10 w-10 animate-spin text-au-ink-5b6cff" aria-hidden />}
          title="Cargando..."
        >
          <span className="sr-only" role="status">Cargando</span>
        </AuthShell>
      }
    >
      <VerifyPhoneInner />
    </Suspense>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
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
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-0 shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="bg-green-100 dark:bg-green-900/30 p-4 rounded-full">
                <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <CardTitle className="text-2xl">Teléfono Verificado</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">Redirigiendo al dashboard...</p>
            <Link href="/dashboard">
              <Button>Ir al Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-0 shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-4 rounded-full">
              <ShieldCheck className="w-12 h-12 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <CardTitle className="text-2xl">Verifica tu Teléfono</CardTitle>
          <CardDescription>
            {codeSent
              ? method === 'whatsapp'
                ? `Enviamos un código de 6 dígitos por WhatsApp a ${maskedPhone}`
                : `Enviamos un código de 6 dígitos a tu correo electrónico`
              : 'Enviando código de verificación...'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* OTP Input */}
          <div className="flex justify-center gap-2 sm:gap-3">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={i === 0 ? OTP_LENGTH : 1}
                value={digit}
                onChange={e => handleDigitChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                disabled={status === 'verifying' || status === 'sending'}
                className="w-11 h-14 sm:w-13 sm:h-16 text-center text-2xl font-bold rounded-xl border-2 
                  border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 
                  focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 
                  outline-none transition-all disabled:opacity-50"
              />
            ))}
          </div>

          {/* Status messages */}
          {status === 'verifying' && (
            <div className="flex items-center justify-center gap-2 text-blue-600 dark:text-blue-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Verificando código...</span>
            </div>
          )}

          {status === 'sending' && (
            <div className="flex items-center justify-center gap-2 text-blue-600 dark:text-blue-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Enviando código...</span>
            </div>
          )}

          {message && status === 'error' && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-center">
              <p className="text-sm text-red-700 dark:text-red-400">{message}</p>
            </div>
          )}

          {message && status === 'idle' && codeSent && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
              <p className="text-sm text-green-700 dark:text-green-400">{message}</p>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              disabled={resendTimer > 0 || status === 'sending' || status === 'verifying'}
              onClick={() => sendCode(method)}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {resendTimer > 0
                ? `Reenviar código (${resendTimer}s)`
                : 'Reenviar código'}
            </Button>

            {method === 'whatsapp' && (
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                disabled={resendTimer > 0 || status === 'sending' || status === 'verifying'}
                onClick={() => sendCode('email')}
              >
                <Mail className="w-4 h-4 mr-2" />
                Enviar por correo electrónico
              </Button>
            )}
          </div>

          {/* Skip / Back */}
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
            <Link href="/dashboard" className="block">
              <Button variant="ghost" className="w-full text-muted-foreground text-sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Verificar después
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyPhonePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
          <Card className="max-w-md w-full border-0 shadow-xl">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
              </div>
              <CardTitle className="text-2xl">Cargando...</CardTitle>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <VerifyPhoneInner />
    </Suspense>
  );
}

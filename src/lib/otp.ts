import { createHash, randomInt } from 'crypto';

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export function generateOTP(): string {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return randomInt(min, max + 1).toString();
}

export function hashOTP(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function verifyOTP(code: string, hash: string): boolean {
  return hashOTP(code) === hash;
}

export function getOTPExpiry(): Date {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
}

export { MAX_ATTEMPTS, OTP_EXPIRY_MINUTES };

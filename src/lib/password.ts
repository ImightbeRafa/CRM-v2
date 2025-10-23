/**
 * Password Security Utilities
 * 
 * Uses bcrypt for secure password hashing with 12 salt rounds.
 * This replaces the previous plain-text password storage.
 */

import bcrypt from 'bcrypt';

/**
 * Number of salt rounds for bcrypt hashing.
 * 12 rounds provides a good balance between security and performance.
 */
const SALT_ROUNDS = 12;

/**
 * Hash a plain-text password using bcrypt.
 * 
 * @param password - Plain-text password to hash
 * @returns Promise<string> - Bcrypt hash string
 * 
 * @example
 * const hash = await hashPassword('myPassword123');
 * // Returns: $2b$12$abc123...
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.trim() === '') {
    throw new Error('Password cannot be empty');
  }
  
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a plain-text password against a bcrypt hash.
 * 
 * @param password - Plain-text password to verify
 * @param hash - Bcrypt hash to compare against
 * @returns Promise<boolean> - True if password matches hash
 * 
 * @example
 * const isValid = await verifyPassword('myPassword123', hashedPassword);
 * if (isValid) {
 *   console.log('Password is correct');
 * }
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }
  
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

/**
 * Check if a string is a bcrypt hash.
 * Bcrypt hashes start with $2a$, $2b$, or $2y$.
 * 
 * @param str - String to check
 * @returns boolean - True if string appears to be a bcrypt hash
 */
export function isBcryptHash(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  
  // Bcrypt hashes start with $2a$, $2b$, or $2y$ followed by cost factor
  return /^\$2[aby]\$\d{2}\$/.test(str);
}

/**
 * Validate password strength.
 * 
 * Requirements:
 * - At least 8 characters
 * - Contains uppercase letter
 * - Contains lowercase letter
 * - Contains number
 * 
 * @param password - Password to validate
 * @returns Object with validation result and error messages
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!password || password.trim() === '') {
    errors.push('La contraseña no puede estar vacía');
    return { valid: false, errors };
  }
  
  if (password.length < 8) {
    errors.push('La contraseña debe tener al menos 8 caracteres');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra mayúscula');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra minúscula');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('La contraseña debe contener al menos un número');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate a random password that meets strength requirements.
 * Useful for temporary passwords or password resets.
 * 
 * @param length - Length of password (default: 12)
 * @returns string - Random secure password
 */
export function generateSecurePassword(length: number = 12): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  
  const allChars = uppercase + lowercase + numbers + special;
  
  let password = '';
  
  // Ensure at least one of each required type
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill rest with random characters
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}


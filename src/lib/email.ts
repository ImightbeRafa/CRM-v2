import { Resend } from 'resend';
import { prisma } from './db';
import { v4 as uuidv4 } from 'uuid';

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendVerificationEmailParams {
  email: string;
  name?: string;
}

interface SendOTPEmailParams {
  email: string;
  code: string;
  name?: string;
}

export async function sendOTPEmail({ email, code, name }: SendOTPEmailParams) {
  try {
    await resend.emails.send({
      from: 'BetsyCRM <noreply@betsycrm.com>',
      to: email,
      subject: 'Tu código de verificación - BetsyCRM',
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #ffffff;">
          <div style="text-align: center; padding: 32px 24px 16px;">
            <h2 style="color: #111827; margin: 0 0 8px; font-size: 22px;">Verifica tu teléfono</h2>
            <p style="color: #6b7280; margin: 0; font-size: 14px;">Hola${name ? ` ${name}` : ''}, usa este código para verificar tu número de teléfono en BetsyCRM.</p>
          </div>
          <div style="text-align: center; padding: 24px;">
            <div style="display: inline-block; background: #f3f4f6; border-radius: 12px; padding: 20px 40px; letter-spacing: 8px; font-size: 36px; font-weight: 700; color: #111827; font-family: 'Courier New', monospace;">
              ${code}
            </div>
          </div>
          <div style="text-align: center; padding: 0 24px 32px;">
            <p style="color: #9ca3af; font-size: 13px; margin: 0;">
              Este código expira en 10 minutos.<br/>
              Si no solicitaste este código, puedes ignorar este correo.
            </p>
          </div>
          <div style="border-top: 1px solid #e5e7eb; padding: 16px 24px; text-align: center;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">BetsyCRM &mdash; Gestión inteligente de ventas</p>
          </div>
        </div>
      `,
    });

    return { success: true };
  } catch (error: any) {
    console.error('[Email] sendOTPEmail error:', error);
    return { success: false, error: error?.message || 'Failed to send OTP email' };
  }
}

export async function sendVerificationEmail({ email, name }: SendVerificationEmailParams) {
  try {
    console.log(`📧 Preparing to send verification email to: ${email}`);
    
    // Generate verification token (valid for 24 hours)
    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Save token to database using raw query for mapped fields
    // Note: Column names in DB might be snake_case, so we check both formats
    try {
      const updateResult = await prisma.$executeRaw`
        UPDATE "User" 
        SET 
          "emailVerificationToken" = ${token},
          "emailVerificationTokenExpires" = ${expiresAt}
        WHERE email = ${email}
      `;
      
      console.log(`✅ Token saved to database for: ${email}`);
      // Token details omitted for security
      console.log(`   Expires: ${expiresAt.toISOString()}`);
      
      // Verify the token was saved correctly
      const verifyUser = await prisma.$queryRaw`
        SELECT "emailVerificationToken", "emailVerificationTokenExpires" 
        FROM "User" 
        WHERE email = ${email}
        LIMIT 1
      `;
      
      if (verifyUser && (Array.isArray(verifyUser) ? verifyUser.length > 0 : verifyUser)) {
        const savedUser = Array.isArray(verifyUser) ? verifyUser[0] : verifyUser;
        if (savedUser.emailVerificationToken === token) {
          console.log(`✅ Token verified in database`);
        } else {
          console.error(`⚠️ Token mismatch! Expected: ${token.substring(0, 8)}..., Got: ${savedUser.emailVerificationToken?.substring(0, 8)}...`);
        }
      }
    } catch (dbError: any) {
      console.error('❌ Error saving token to database:', dbError);
      // Try with snake_case column names as fallback
      try {
        await prisma.$executeRaw`
          UPDATE "User" 
          SET 
            "email_verification_token" = ${token},
            "email_verification_token_expires" = ${expiresAt}
          WHERE email = ${email}
        `;
        console.log(`✅ Token saved using snake_case columns`);
      } catch (fallbackError) {
        console.error('❌ Fallback save also failed:', fallbackError);
        throw dbError; // Throw original error
      }
    }

    // Send verification email
    // Use betsycrm.com domain, fallback to environment variable or localhost for development
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
                   process.env.NEXTAUTH_URL ||
                   (process.env.NODE_ENV === 'production' ? 'https://betsycrm.com' : 'http://localhost:3000');
    
    // Point to the page route, not the API route directly
    const verificationUrl = `${baseUrl}/auth/verify-email?token=${token}`;
    
    console.log(`📧 Sending verification email from: BetsyCRM <noreply@betsycrm.com>`);
    console.log(`📧 Verification URL: ${verificationUrl}`);
    
    const emailResult = await resend.emails.send({
      from: 'BetsyCRM <noreply@betsycrm.com>',
      to: email,
      subject: 'Verifica tu correo electrónico',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>¡Bienvenido a BetsyCRM!</h2>
          <p>Hola ${name || ''},</p>
          <p>Gracias por registrarte en BetsyCRM. Por favor verifica tu dirección de correo electrónico haciendo clic en el siguiente enlace:</p>
          <p>
            <a href="${verificationUrl}" style="display: inline-block; padding: 10px 20px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
              Verificar mi correo
            </a>
          </p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p style="word-break: break-all; color: #3b82f6;">${verificationUrl}</p>
          <p>Este enlace expirará en 24 horas.</p>
          <p>Si no creaste una cuenta en BetsyCRM, puedes ignorar este correo.</p>
          <p>¡Gracias!<br>El equipo de BetsyCRM</p>
        </div>
      `,
    });

    console.log(`✅ Verification email sent successfully to: ${email}`, emailResult);
    return { success: true };
  } catch (error: any) {
    console.error('❌ Error sending verification email:', error);
    console.error('Error details:', {
      message: error?.message,
      name: error?.name,
      stack: error?.stack
    });
    return { 
      success: false, 
      error: error?.message || 'Failed to send verification email' 
    };
  }
}

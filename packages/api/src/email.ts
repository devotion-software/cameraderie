import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from './env.js';
import { captureError } from './observability.js';

let resendClient: Resend | null = null;
let smtpTransport: Transporter | null = null;

function getResendClient(): Resend | null {
  const env = loadEnv();
  if (!env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

function getSmtpTransport(): Transporter | null {
  const env = loadEnv();
  if (!env.SMTP_HOST) return null;
  if (!smtpTransport) {
    // Mailpit (local dev) has no auth/TLS — a plain unauthenticated connection
    // works for it and any other dev-mode SMTP catcher pointed at via SMTP_HOST.
    smtpTransport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
    });
  }
  return smtpTransport;
}

/**
 * Send the sign-in OTP email. Preference order: SMTP (Mailpit in local dev —
 * set SMTP_HOST, view codes at http://localhost:8025), then Resend
 * (RESEND_API_KEY, production), then — with neither configured — logging the
 * code to the console so local sign-in still works. Mirrors the
 * `ALLOWED_SIGNUP_EMAILS` dev-fallback pattern in auth.ts.
 */
export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  const env = loadEnv();
  const subject = `${otp} is your Cameraderie sign-in code`;
  const text = `Your sign-in code is ${otp}. It expires in 5 minutes.\n\nIf you didn't request this, you can ignore this email.`;

  const smtp = getSmtpTransport();
  if (smtp) {
    await smtp.sendMail({ from: env.EMAIL_FROM, to: email, subject, text });
    return;
  }

  const resend = getResendClient();
  if (!resend) {
    console.warn(`[email] No SMTP_HOST/RESEND_API_KEY set — sign-in code for ${email}: ${otp}`);
    return;
  }
  try {
    await resend.emails.send({ from: env.EMAIL_FROM, to: email, subject, text });
  } catch (err) {
    captureError(err);
    throw err;
  }
}

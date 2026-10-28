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
  // The code is never in the subject line — subjects are often shown in
  // notification previews/widgets that are visible to anyone glancing at the
  // recipient's lock screen, which would leak the sign-in code.
  const subject = 'Your Cameraderie sign-in code';
  const text = `Your sign-in code is ${otp}. It expires in 5 minutes.\n\nIf you didn't request this, you can ignore this email.`;
  const html = otpEmailHtml(otp);

  const smtp = getSmtpTransport();
  if (smtp) {
    await smtp.sendMail({ from: env.EMAIL_FROM, to: email, subject, text, html });
    return;
  }

  const resend = getResendClient();
  if (!resend) {
    console.warn(`[email] No SMTP_HOST/RESEND_API_KEY set — sign-in code for ${email}: ${otp}`);
    return;
  }
  try {
    await resend.emails.send({ from: env.EMAIL_FROM, to: email, subject, text, html });
  } catch (err) {
    captureError(err);
    throw err;
  }
}

/** Branded HTML for the sign-in OTP email, matching the app's indigo/magenta palette. */
function otpEmailHtml(otp: string): string {
  const digits = otp
    .split('')
    .map(
      (d) =>
        `<span style="display:inline-block;min-width:34px;margin:0 3px;padding:10px 0;border-radius:8px;background:#f3f1ff;color:#191633;font-size:24px;font-weight:700;font-family:Georgia,serif;text-align:center;">${d}</span>`,
    )
    .join('');

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#eef1fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table
            role="presentation"
            width="100%"
            style="max-width:420px;background:#ffffff;border-radius:16px;padding:36px 32px;"
          >
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <span
                  style="font-size:18px;font-weight:700;letter-spacing:-0.01em;background:linear-gradient(135deg,#5b5bf5,#c84fe0);-webkit-background-clip:text;background-clip:text;color:#5b5bf5;"
                >
                  Cameraderie
                </span>
              </td>
            </tr>
            <tr>
              <td align="center" style="color:#191633;font-size:15px;line-height:1.5;padding-bottom:20px;">
                Here's your sign-in code. It expires in 5 minutes.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:20px;">${digits}</td>
            </tr>
            <tr>
              <td align="center" style="color:#5c5880;font-size:13px;line-height:1.5;">
                If you didn't request this, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

/** Emails sent via the console-log fallback (SMTP unconfigured). Tests read this. */
export const outbox: SentEmail[] = [];

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(msg: SentEmail): Promise<void> {
  if (!config.smtp.enabled) {
    console.warn(`[email:fallback] To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}`);
    outbox.push(msg);
    return;
  }
  await getTransporter().sendMail({
    from: config.smtp.from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
  });
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${config.clientOrigin}/verify-email?token=${token}`;
  await sendMail({
    to,
    subject: 'Confirm your AutomationSolver email',
    text: `Welcome to AutomationSolver! Confirm your email:\n\n${link}\n\nThis link expires in 24 hours.`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${config.clientOrigin}/reset-password?token=${token}`;
  await sendMail({
    to,
    subject: 'Reset your AutomationSolver password',
    text: `Reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
  });
}

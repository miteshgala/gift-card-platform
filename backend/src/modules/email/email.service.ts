import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

// ─── Email Templates ──────────────────────────────────────────────────────────

function eGiftCardHtml(params: {
  recipientName?: string;
  cardNumber: string;
  pin: string;
  balance: number;
  currency: string;
  cardNumberMasked: string;
  expiresAt?: Date;
}): string {
  const expiryLine = params.expiresAt
    ? `<p style="color:#666;">Expires: <strong>${params.expiresAt.toLocaleDateString()}</strong></p>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Your Gift Card</title></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:40px;border-radius:12px;text-align:center;color:white;">
    <h1 style="margin:0 0 10px;">🎁 Your Gift Card</h1>
    <p style="font-size:18px;margin:0;">Hello, ${params.recipientName ?? 'there'}!</p>
  </div>
  <div style="background:#f9f9f9;padding:30px;border-radius:0 0 12px 12px;text-align:center;">
    <div style="background:white;border-radius:8px;padding:20px;margin:20px 0;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <p style="color:#666;margin:0 0 5px;">Card Number</p>
      <h2 style="font-family:monospace;letter-spacing:4px;margin:0;">${params.cardNumber.replace(/(\d{4})/g, '$1 ').trim()}</h2>
    </div>
    <div style="display:flex;gap:20px;justify-content:center;">
      <div style="background:white;border-radius:8px;padding:15px 25px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <p style="color:#666;margin:0 0 5px;font-size:12px;">PIN</p>
        <h3 style="font-family:monospace;margin:0;">${params.pin}</h3>
      </div>
      <div style="background:white;border-radius:8px;padding:15px 25px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <p style="color:#666;margin:0 0 5px;font-size:12px;">Balance</p>
        <h3 style="margin:0;">${params.currency} ${params.balance.toFixed(2)}</h3>
      </div>
    </div>
    ${expiryLine}
    <p style="color:#999;font-size:12px;margin-top:20px;">Keep this card secure. Treat it like cash.</p>
  </div>
</body>
</html>`;
}

// ─── Send eGift Card ──────────────────────────────────────────────────────────

export async function sendEGiftCard(params: {
  to: string;
  recipientName?: string;
  cardNumber: string;
  pin: string;
  balance: number;
  currency: string;
  cardNumberMasked: string;
  expiresAt?: Date;
}): Promise<void> {
  try {
    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: `Your ${params.currency} ${params.balance.toFixed(2)} Gift Card`,
      html: eGiftCardHtml(params),
    });
    logger.info('eGift card email sent', { to: params.to, maskedCard: params.cardNumberMasked });
  } catch (err) {
    logger.error('Failed to send eGift card email', {
      to: params.to,
      error: err instanceof Error ? err.message : 'Unknown',
    });
    throw err;
  }
}

export async function sendCardResend(params: {
  to: string;
  recipientName?: string;
  cardNumber: string;
  pin: string;
  balance: number;
  currency: string;
  cardNumberMasked: string;
  expiresAt?: Date;
}): Promise<void> {
  await sendEGiftCard({ ...params });
}

/**
 * Vault Client — used by the core API to communicate with the tokenization vault.
 * All requests include the shared internal secret header.
 * In production this channel is also mTLS-authenticated at the network layer.
 */

import { env } from './env';
import { logger } from './logger';

const VAULT_SECRET = process.env['VAULT_INTERNAL_SECRET'] ?? 'dev-vault-secret';

async function vaultFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${env.VAULT_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Vault-Secret': VAULT_SECRET,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  return response;
}

export interface TokenizeResult {
  token: string;
  last4: string;
  bin: string;
}

export interface TokenMetadata {
  token: string;
  last4: string;
  bin: string;
  keyVersion: number;
  createdAt: string;
}

/**
 * Store a PAN in the vault, receive a token.
 * The PAN is never stored in the application database.
 */
export async function tokenizePan(pan: string): Promise<TokenizeResult> {
  const response = await vaultFetch('/tokens', {
    method: 'POST',
    body: JSON.stringify({ pan }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
    throw new Error(`Vault tokenize failed: ${body.error?.code ?? response.status}`);
  }

  return response.json() as Promise<TokenizeResult>;
}

/**
 * Get token metadata (last4, bin) — does NOT return the PAN.
 */
export async function getTokenMetadata(token: string): Promise<TokenMetadata> {
  const response = await vaultFetch(`/tokens/${encodeURIComponent(token)}`);

  if (response.status === 404) throw new Error('Token not found in vault');
  if (!response.ok) throw new Error(`Vault metadata failed: ${response.status}`);

  return response.json() as Promise<TokenMetadata>;
}

/**
 * Reveal the underlying PAN — only for cardholder self-service with step-up auth.
 * Every call is audit-logged by the vault.
 */
export async function revealPan(token: string, requesterId: string, reason: string): Promise<string> {
  const response = await vaultFetch('/reveal', {
    method: 'POST',
    body: JSON.stringify({ token, requesterId, reason }),
  });

  if (!response.ok) {
    logger.warn('Vault reveal failed', { requesterId, status: response.status });
    throw new Error(`Vault reveal failed: ${response.status}`);
  }

  const { pan } = await response.json() as { pan: string };
  return pan;
}

/**
 * Delete a token (GDPR right to erasure — on card close).
 */
export async function deleteToken(token: string): Promise<void> {
  const response = await vaultFetch(`/tokens/${encodeURIComponent(token)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Vault delete failed: ${response.status}`);
  }
}

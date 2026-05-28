/**
 * Prometheus Metrics
 *
 * Exposes default Node.js metrics + application-specific counters/histograms.
 * Served at GET /metrics (scrape endpoint for Prometheus / Grafana Cloud).
 */
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

export const register = new Registry();
register.setDefaultLabels({ app: 'gift-card-api' });

// Default Node.js metrics (heap, event loop lag, GC, etc.)
collectDefaultMetrics({ register });

// ─── HTTP metrics ─────────────────────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// ─── Business metrics ─────────────────────────────────────────────────────────

export const cardsIssued = new Counter({
  name: 'gift_cards_issued_total',
  help: 'Total gift cards issued',
  labelNames: ['program_id', 'card_type'],
  registers: [register],
});

export const ledgerTransactions = new Counter({
  name: 'ledger_transactions_total',
  help: 'Total ledger transactions by type',
  labelNames: ['type', 'program_id'],
  registers: [register],
});

export const webhookDeliveries = new Counter({
  name: 'webhook_deliveries_total',
  help: 'Webhook delivery outcomes',
  labelNames: ['event', 'status'],
  registers: [register],
});

export const kycChecks = new Counter({
  name: 'kyc_checks_total',
  help: 'KYC check outcomes',
  labelNames: ['status'],
  registers: [register],
});

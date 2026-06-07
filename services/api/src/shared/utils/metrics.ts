import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// ─── Business Counters ────────────────────────────────────────────────────────

export const authorizationsTotal = new Counter({
  name: 'gift_card_authorizations_total',
  help: 'Total authorization attempts',
  labelNames: ['program_id', 'decision', 'decline_code'] as const,
  registers: [registry],
});

export const fraudFlagsTotal = new Counter({
  name: 'gift_card_fraud_flags_total',
  help: 'Total fraud flags raised',
  labelNames: ['program_id', 'severity', 'source'] as const,
  registers: [registry],
});

export const dormancyFeesTotal = new Counter({
  name: 'gift_card_dormancy_fees_total',
  help: 'Total dormancy fees assessed',
  labelNames: ['program_id'] as const,
  registers: [registry],
});

export const cardsIssuedTotal = new Counter({
  name: 'gift_card_cards_issued_total',
  help: 'Total cards issued',
  labelNames: ['program_id', 'card_type'] as const,
  registers: [registry],
});

export const webhookDeliveriesTotal = new Counter({
  name: 'gift_card_webhook_deliveries_total',
  help: 'Total webhook delivery attempts',
  labelNames: ['status'] as const,
  registers: [registry],
});

// ─── Latency Histograms ───────────────────────────────────────────────────────

export const authLatency = new Histogram({
  name: 'gift_card_auth_latency_seconds',
  help: 'Authorization processing latency in seconds',
  labelNames: ['decision'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
  registers: [registry],
});

export const fraudEngineLatency = new Histogram({
  name: 'gift_card_fraud_engine_latency_seconds',
  help: 'Fraud engine response latency',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.08, 0.1, 0.2],
  registers: [registry],
});

export const dbQueryLatency = new Histogram({
  name: 'gift_card_db_query_latency_seconds',
  help: 'Database query latency',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5],
  registers: [registry],
});

export const httpRequestLatency = new Histogram({
  name: 'gift_card_http_request_duration_seconds',
  help: 'HTTP request processing latency',
  labelNames: ['method', 'path', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

// ─── Financial Gauges (updated by reconciliation job) ─────────────────────────

export const floatVarianceCents = new Gauge({
  name: 'gift_card_float_variance_cents',
  help: 'Float variance vs total card balances (should be near 0)',
  labelNames: ['program_id'] as const,
  registers: [registry],
});

export const totalCardBalancesCents = new Gauge({
  name: 'gift_card_total_card_balances_cents',
  help: 'Total outstanding card balances',
  labelNames: ['program_id', 'currency'] as const,
  registers: [registry],
});

export const activeCardsCount = new Gauge({
  name: 'gift_card_active_cards_count',
  help: 'Number of active cards',
  labelNames: ['program_id'] as const,
  registers: [registry],
});

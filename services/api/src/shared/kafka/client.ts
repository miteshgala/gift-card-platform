import { Kafka, Producer, Consumer, logLevel } from 'kafkajs';
import { env } from '../utils/env';
import { logger } from '../utils/logger';

const kafka = new Kafka({
  clientId: 'giftcard-api',
  brokers: env.KAFKA_BROKERS.split(','),
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 100, retries: 8 },
});

let producer: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (producer) return producer;
  producer = kafka.producer({
    allowAutoTopicCreation: false,
    transactionTimeout: 30000,
  });
  await producer.connect();
  logger.info('Kafka producer connected');
  return producer;
}

export async function createConsumer(groupId: string): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  logger.info('Kafka consumer connected', { groupId });
  return consumer;
}

// Topic names — single source of truth
export const TOPICS = {
  CARD_EVENTS: 'card-events',
  AUTHORIZATION_EVENTS: 'authorization-events',
  LEDGER_ENTRIES: 'ledger-entries',
  COMPLIANCE_EVENTS: 'compliance-events',
  WEBHOOK_DELIVERIES: 'webhook-deliveries',
  AUDIT_LOG: 'audit-log',
  SETTLEMENT_EVENTS: 'settlement-events',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

export interface KafkaMessage<T = unknown> {
  topic: TopicName;
  key?: string;
  value: T;
}

export async function publish<T>(message: KafkaMessage<T>): Promise<void> {
  const prod = await getProducer();
  try {
    await prod.send({
      topic: message.topic,
      messages: [
        {
          key: message.key ?? null,
          value: JSON.stringify(message.value),
        },
      ],
    });
  } catch (err) {
    logger.error('Failed to publish Kafka message', { topic: message.topic, error: err });
    // Non-fatal — do not re-throw. Financial operations must not fail because of
    // event publishing. The event can be reconstructed from the DB if needed.
  }
}

// Graceful shutdown
process.on('beforeExit', async () => {
  if (producer) await producer.disconnect();
});

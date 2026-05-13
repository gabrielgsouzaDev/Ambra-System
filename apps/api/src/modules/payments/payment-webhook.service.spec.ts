import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PaymentWebhookService,
  UnauthorizedWebhookError,
  type PaymentWebhookProcessor,
  type PaymentWebhookRepository,
  type WebhookReceipt,
} from './payment-webhook.service.ts';

const WEBHOOK_TOKEN = 'asaas-test-token-with-enough-length';
const PAYLOAD = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } };
const RAW_BODY = Buffer.from(JSON.stringify(PAYLOAD));

function createReceipt(overrides: Partial<WebhookReceipt> = {}): WebhookReceipt {
  return {
    id: 'receipt-1',
    provider: 'ASAAS',
    externalId: 'evt_1',
    eventType: 'PAYMENT_RECEIVED',
    processingResult: null,
    processedAt: null,
    payload: PAYLOAD,
    ...overrides,
  };
}

test('handleAsaasWebhook rejects invalid signatures before recording a receipt', async () => {
  const calls: string[] = [];
  const repository = createRepository(calls);
  const service = new PaymentWebhookService({
    webhookToken: WEBHOOK_TOKEN,
    repository,
    processor: createProcessor(calls),
  });

  await assert.rejects(
    () => service.handleAsaasWebhook({ token: 'wrong', rawBody: RAW_BODY, payload: PAYLOAD }),
    UnauthorizedWebhookError,
  );

  assert.deepEqual(calls, []);
});

test('handleAsaasWebhook records the receipt before processing the payment event', async () => {
  const calls: string[] = [];
  const service = new PaymentWebhookService({
    webhookToken: WEBHOOK_TOKEN,
    repository: createRepository(calls),
    processor: createProcessor(calls),
  });

  const result = await service.handleAsaasWebhook({ token: WEBHOOK_TOKEN, rawBody: RAW_BODY, payload: PAYLOAD });

  assert.deepEqual(calls, ['registerReceipt', 'process', 'markProcessed']);
  assert.deepEqual(result, { received: true, processed: true });
});

test('handleAsaasWebhook ignores duplicate receipts already processed successfully', async () => {
  const calls: string[] = [];
  const service = new PaymentWebhookService({
    webhookToken: WEBHOOK_TOKEN,
    repository: createRepository(calls, createReceipt({ processingResult: 'SUCCESS', processedAt: new Date() })),
    processor: createProcessor(calls),
  });

  const result = await service.handleAsaasWebhook({ token: WEBHOOK_TOKEN, rawBody: RAW_BODY, payload: PAYLOAD });

  assert.deepEqual(calls, ['registerReceipt']);
  assert.deepEqual(result, { received: true, processed: false });
});

test('handleAsaasWebhook retries receipts left in error state without creating a second receipt', async () => {
  const calls: string[] = [];
  const service = new PaymentWebhookService({
    webhookToken: WEBHOOK_TOKEN,
    repository: createRepository(calls, createReceipt({ processingResult: 'ERROR', processedAt: null })),
    processor: createProcessor(calls),
  });

  const result = await service.handleAsaasWebhook({ token: WEBHOOK_TOKEN, rawBody: RAW_BODY, payload: PAYLOAD });

  assert.deepEqual(calls, ['registerReceipt', 'process', 'markProcessed']);
  assert.deepEqual(result, { received: true, processed: true });
});

test('handleAsaasWebhook returns received and marks the receipt as failed when processing fails', async () => {
  const calls: string[] = [];
  const service = new PaymentWebhookService({
    webhookToken: WEBHOOK_TOKEN,
    repository: createRepository(calls),
    processor: createProcessor(calls, new Error('temporary database error')),
  });

  const result = await service.handleAsaasWebhook({ token: WEBHOOK_TOKEN, rawBody: RAW_BODY, payload: PAYLOAD });

  assert.deepEqual(calls, ['registerReceipt', 'process', 'markFailed']);
  assert.deepEqual(result, { received: true, processed: false });
});

function createRepository(calls: string[], receipt = createReceipt()): PaymentWebhookRepository {
  return {
    async registerReceipt(): Promise<WebhookReceipt> {
      calls.push('registerReceipt');
      return receipt;
    },
    async markProcessed(): Promise<void> {
      calls.push('markProcessed');
    },
    async markFailed(): Promise<void> {
      calls.push('markFailed');
    },
  };
}

function createProcessor(calls: string[], error?: Error): PaymentWebhookProcessor {
  return {
    async process(): Promise<void> {
      calls.push('process');
      if (error) {
        throw error;
      }
    },
  };
}

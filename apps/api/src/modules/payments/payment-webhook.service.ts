import { timingSafeEqual } from 'node:crypto';

export type PaymentProvider = 'ASAAS';
export type WebhookProcessingResult = 'SUCCESS' | 'ERROR' | 'IGNORED' | null;

export interface WebhookReceipt {
  id: string;
  provider: PaymentProvider;
  externalId: string | null;
  eventType: string | null;
  payload: unknown;
  processingResult: WebhookProcessingResult;
  processedAt: Date | null;
}

export interface RegisterWebhookReceiptInput {
  provider: PaymentProvider;
  rawBody: Buffer;
  payload: unknown;
}

export interface PaymentWebhookRepository {
  registerReceipt(input: RegisterWebhookReceiptInput): Promise<WebhookReceipt>;
  markProcessed(receiptId: string): Promise<void>;
  markFailed(receiptId: string, error: unknown): Promise<void>;
}

export interface PaymentWebhookProcessor {
  process(receipt: WebhookReceipt): Promise<void>;
}

export interface HandleAsaasWebhookInput {
  token: string | undefined;
  rawBody: Buffer;
  payload: unknown;
}

export interface HandleAsaasWebhookResult {
  received: true;
  processed: boolean;
}

export class UnauthorizedWebhookError extends Error {
  constructor() {
    super('Invalid webhook signature');
    this.name = 'UnauthorizedWebhookError';
  }
}

export interface PaymentWebhookServiceOptions {
  webhookToken: string;
  repository: PaymentWebhookRepository;
  processor: PaymentWebhookProcessor;
}

export class PaymentWebhookService {
  webhookToken: string;
  repository: PaymentWebhookRepository;
  processor: PaymentWebhookProcessor;

  constructor(options: PaymentWebhookServiceOptions) {
    this.webhookToken = options.webhookToken;
    this.repository = options.repository;
    this.processor = options.processor;
  }

  async handleAsaasWebhook(input: HandleAsaasWebhookInput): Promise<HandleAsaasWebhookResult> {
    if (!this.verifyAsaasSignature(input.token)) {
      throw new UnauthorizedWebhookError();
    }

    const receipt = await this.repository.registerReceipt({
      provider: 'ASAAS',
      rawBody: input.rawBody,
      payload: input.payload,
    });

    if (isTerminalReceipt(receipt)) {
      return { received: true, processed: false };
    }

    try {
      await this.processor.process(receipt);
      await this.repository.markProcessed(receipt.id);
      return { received: true, processed: true };
    } catch (error) {
      await this.repository.markFailed(receipt.id, error);
      return { received: true, processed: false };
    }
  }

  verifyAsaasSignature(token: string | undefined): boolean {
    if (!token) {
      return false;
    }

    const expected = Buffer.from(this.webhookToken);
    const received = Buffer.from(token);

    return expected.length === received.length && timingSafeEqual(expected, received);
  }
}

function isTerminalReceipt(receipt: WebhookReceipt): boolean {
  return receipt.processingResult === 'SUCCESS' || receipt.processingResult === 'IGNORED';
}

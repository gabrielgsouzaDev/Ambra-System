# Forbidden Patterns — O que Nunca Fazer

**Este documento lista decisões e padrões que estão PROIBIDOS no projeto Ambra.**
Qualquer agente de IA deve verificar esta lista antes de propor qualquer implementação.

---

## Proibições de Segurança

### localStorage para Tokens
```typescript
// ✗ PROIBIDO — vulnerável a XSS
localStorage.setItem('access_token', token);
sessionStorage.setItem('token', token);

// ✓ Correto
// Access token: memória (variável React state ou contexto)
// Refresh token: HttpOnly cookie (gerenciado pelo servidor)
```

### JWT_SECRET com Fallback
```typescript
// ✗ PROIBIDO
const secret = process.env.JWT_SECRET || 'fallback-insecure-secret';

// ✓ Correto
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is required');
```

### Query sem Filtro de Tenant
```typescript
// ✗ PROIBIDO — retorna dados de TODOS os tenants
await prisma.order.findMany({ where: { studentId } });

// ✓ Correto — sempre filtrar por schoolId
await prisma.order.findMany({ where: { studentId, schoolId: ctx.schoolId } });
```

### `findUnique` em tabela de tenant com id da request
```typescript
// ✗ PROIBIDO — a chave única não carrega o tenant e pode atravessar isolamento
await prisma.order.findUnique({ where: { id: orderId } });
await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

// ✓ Correto — lookup tenant-aware explícito
await prisma.order.findFirst({ where: { id: orderId, schoolId: ctx.schoolId } });
await prisma.order.findFirstOrThrow({ where: { id: orderId, schoolId: ctx.schoolId } });
```

### Endpoint Público sem @Public()
```typescript
// ✗ PROIBIDO — guards globais seriam bypassados silenciosamente sem o decorator
@Get('catalog')  // parece público, mas o guard vai rejeitar
async getPublicCatalog() { ... }

// ✓ Correto — rotas públicas são explícitas
@Get('catalog')
@Public()  // intenção clara
async getPublicCatalog() { ... }
```

### Webhook sem receipt-first
```typescript
// ✗ PROIBIDO — processa antes de registrar o receipt e deixa janela de duplicidade
@Post('webhook/asaas')
@Public()
async handleWebhook(@Body() payload: unknown) {
  await this.creditWallet(payload);  // nunca antes de persistir o webhook
}

// ✓ Correto — assinatura, receipt, tenant, processamento idempotente
@Post('webhook/asaas')
@Public()
async handleWebhook(@Headers('asaas-access-token') token: string, @RawBody() rawBody: Buffer) {
  // 1. Validar HMAC
  // 2. Inserir receipt em payment_webhooks
  // 3. Resolver o tenant pela cobrança
  // 4. Processar de forma idempotente
  // 5. 200 significa "recebido e registrado", mesmo se o processamento posterior falhar
}
```

---

## Proibições de Dados Financeiros

### Escrita Direta no Saldo
```typescript
// ✗ PROIBIDO
await prisma.wallet.update({ data: { balance: newBalance } });

// ✓ Correto — cria transação, trigger atualiza saldo
await prisma.walletTransaction.create({ data: { type: 'CREDIT', amount: value, ... } });
```

### Modificação de Registros Imutáveis
```typescript
// ✗ PROIBIDO
await prisma.walletTransaction.delete({ where: { id } });
await prisma.walletTransaction.update({ where: { id }, data: { amount: newAmount } });
await prisma.auditLog.delete({ where: { id } });
await prisma.auditLog.update({ ... });
await prisma.paymentWebhook.delete({ ... });
```

### Operações Financeiras Fora de Transação
```typescript
// ✗ PROIBIDO — se a segunda operação falhar, o estado fica inconsistente
await prisma.walletTransaction.create({ type: 'DEBIT', ... });
await prisma.order.update({ status: 'CONFIRMED' });

// ✓ Correto
await prisma.$transaction(async (tx) => {
  await tx.walletTransaction.create({ type: 'DEBIT', ... });
  await tx.order.update({ status: 'CONFIRMED' });
});
```

### Webhook sem Idempotência
```typescript
// ✗ PROIBIDO — webhook duplicado credita duas vezes
async processPayment(payload: WebhookPayload) {
  await this.creditWallet(payload.walletId, payload.amount);
}

// ✓ Correto — idempotency_key previne duplicata
async processPayment(payload: WebhookPayload) {
  await prisma.walletTransaction.create({
    data: {
      ...transactionData,
      idempotencyKey: `asaas-${payload.id}`,  // UNIQUE no banco
    }
  });
}
```

---

## Proibições de Arquitetura

### Importação de Internals entre Módulos
```typescript
// ✗ PROIBIDO — importar internal de outro módulo
import { WalletRepository } from '../wallet/wallet.repository';

// ✓ Correto — importar apenas a interface pública (service)
import { WalletService } from '../wallet/wallet.service';
```

### Módulo importando de módulo "acima" na hierarquia
```typescript
// ✗ PROIBIDO — wallet não pode depender de orders
// apps/api/src/modules/wallet/wallet.service.ts
import { OrdersService } from '../orders/orders.service';  // ciclo de dependência
```

### Feature fora do MVP sem aprovação
```typescript
// ✗ PROIBIDO — não está no MVP
// NutritionModule, RiskModule, FiscalModule, NativeAppController
// Coupon, Discount, Subscription, WhiteLabel, BillingPlan
```

### Abstração prematura
```typescript
// ✗ PROIBIDO — só existe um gateway (Asaas), não crie interface genérica
interface PaymentGateway {
  createCharge(data: unknown): Promise<unknown>;
}
class AsaasGateway implements PaymentGateway { ... }
class StripeGateway implements PaymentGateway { ... }  // não existe, não crie

// ✓ Correto — chame Asaas diretamente com serviço bem definido
class PaymentsService {
  async createPixCharge(data: CreatePixChargeDto): Promise<PixChargeResult> { ... }
}
```

### Filas de mensagens
```typescript
// ✗ PROIBIDO no MVP
// Bull, BullMQ, RabbitMQ, SQS — não use
// Webhooks são processados de forma síncrona com retry manual
```

---

## Proibições de Código

### any em código de produção
```typescript
// ✗ PROIBIDO
function handleWebhook(payload: any): any { ... }
const data: any = await fetch(...).json();

// ✓ Correto
function handleWebhook(payload: AsaasWebhookPayload): Promise<void> { ... }
const data: AsaasWebhookPayload = await fetch(...).json() as AsaasWebhookPayload;
```

### console.log
```typescript
// ✗ PROIBIDO em código de produção
console.log('order created:', order);

// ✓ Correto
this.logger.log({ action: 'order.created', orderId: order.id });
```

### Dados sensíveis em logs
```typescript
// ✗ PROIBIDO
logger.error(`Auth failed for user ${user.email} with password ${password}`);
logger.info(`Wallet balance: ${wallet.balance}, CPF: ${user.document}`);

// ✓ Correto
logger.warn({ action: 'auth.failed', userId: user.id });
logger.info({ action: 'wallet.credited', walletId: wallet.id });
```

### Variável de ambiente sem validação
```typescript
// ✗ PROIBIDO
const apiKey = process.env.ASAAS_API_KEY;  // pode ser undefined

// ✓ Correto — validar no startup
const apiKey = process.env.ASAAS_API_KEY;
if (!apiKey) throw new Error('ASAAS_API_KEY is required');
```

---

## Proibições de Produto

Não implemente nenhum destes itens sem aprovação explícita documentada em `docs/01-mvp.md`:

- Aplicativo nativo (iOS, Android, React Native, Expo)
- IA / machine learning / recomendações nutricionais
- Integração fiscal (NFC-e, SAT, CF-e, SEFAZ)
- Módulo B2G / escola pública / licitação
- Análise de risco / Serasa / bureau de crédito
- Cupons, descontos, promoções
- Planos de assinatura com features diferentes
- White-label / customização por tenant
- Console global de super-admin com UI
- Sistema offline industrial para PDV
- Chat ou mensagens entre escola e responsável
- Cardápio semanal ou planejamento nutricional
- Múltiplos gateways de pagamento
- Pagamento por cartão de débito/crédito no PDV
- Importação de dados via integração com SGE (sistema de gestão escolar)

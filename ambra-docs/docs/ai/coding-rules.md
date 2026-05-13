# Coding Rules — Padrões Obrigatórios

**Estas regras se aplicam a todo código gerado para o projeto Ambra.**

---

## TypeScript

```typescript
// ✓ Tipagem explícita em assinaturas de função
async createOrder(dto: CreateOrderDto, ctx: TenantContext): Promise<OrderResponse>

// ✓ Interfaces para objetos de domínio
interface TenantContext {
  schoolId: string;
  userId: string;
  role: UserRole;
}

// ✗ Proibido — any em código de produção
function process(data: any): any { ... }

// ✗ Proibido — type assertion sem razão
const order = result as Order;

// ✓ Type guard quando necessário
function isOrder(value: unknown): value is Order {
  return typeof value === 'object' && value !== null && 'id' in value;
}
```

---

## NestJS — Estrutura de Módulo

Cada módulo segue esta estrutura padrão:

```
modules/orders/
├── orders.module.ts          ← importações e exports
├── orders.controller.ts      ← endpoints, DTOs, decorators
├── orders.service.ts         ← regras de negócio
├── orders.repository.ts      ← queries de banco (opcional, se complexo)
├── dto/
│   ├── create-order.dto.ts
│   └── order-response.dto.ts
└── orders.spec.ts            ← testes do serviço
```

```typescript
// ✓ Controller apenas orquestra — sem lógica de negócio
@Post()
@Roles(UserRole.CANTEEN_OP, UserRole.SCHOOL_ADMIN)
async create(
  @Body() dto: CreateOrderDto,
  @CurrentUser() user: AuthUser,
): Promise<ApiResponse<OrderResponse>> {
  const order = await this.ordersService.create(dto, user);
  return { data: order };
}

// ✗ Lógica de negócio no controller
@Post()
async create(@Body() dto: CreateOrderDto) {
  const wallet = await this.prisma.wallet.findFirst(...)
  if (wallet.balance < dto.total) throw new Error(...)
  // ← isso pertence ao service
}
```

---

## Banco de Dados

### Leituras Tenant-Aware

```typescript
// ✓ Correto — lookup tenant-aware explícito
const order = await tx.order.findFirstOrThrow({
  where: { id: orderId, schoolId: ctx.schoolId },
});

const wallet = await tx.wallet.findFirstOrThrow({
  where: { userId: order.studentId, schoolId: ctx.schoolId },
});

// ✗ Errado — findUnique com id vindo da request em tabela de tenant
const unsafeOrder = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
```

### Operações Financeiras Sempre em Transação

```typescript
// ✓ Correto — validações autoritativas dentro da transação
async confirmOrder(orderId: string, ctx: TenantContext): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirstOrThrow({
      where: { id: orderId, schoolId: ctx.schoolId },
    });
    const wallet = await tx.wallet.findFirstOrThrow({
      where: { userId: order.studentId, schoolId: ctx.schoolId },
    });

    // O front pode pré-validar, mas a decisão real acontece aqui.
    if (wallet.balance < order.totalAmount) {
      throw new BusinessException('INSUFFICIENT_BALANCE', 'Saldo insuficiente');
    }

    // 1. Reserva estoque.
    // 2. Debita saldo.
    // 3. Marca o pedido como CONFIRMED e registra quem finalizou.
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount: order.totalAmount,
        source: 'ORDER',
        referenceId: order.id,
        idempotencyKey: `order-debit-${order.id}`,
        description: `Pedido #${order.id}`,
        balanceAfter: wallet.balance - order.totalAmount,
      },
    });

    await tx.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED', confirmedBy: ctx.userId },
    });
  });
}

// ✗ Errado — operações financeiras separadas (inconsistência possível)
await this.prisma.walletTransaction.create(...);  // pode passar
await this.prisma.order.update(...);              // pode falhar → saldo debitado, pedido não confirmado
```

### Nunca Escreva Diretamente no Saldo

```typescript
// ✗ Proibido
await prisma.wallet.update({ data: { balance: newBalance } });

// ✓ Correto — cria transação, trigger atualiza saldo
await prisma.walletTransaction.create({
  data: { type: 'CREDIT', amount: value, ... }
});
```

### Webhooks Semi-Públicos

```typescript
// ✓ Correto — a rota não tem JWT, mas exige HMAC e receipt-first
@Post('webhook/asaas')
@Public()
async handleAsaasWebhook(
  @Headers('asaas-access-token') token: string,
  @RawBody() rawBody: Buffer,
  @Body() payload: unknown,
): Promise<{ received: boolean }> {
  if (!this.verifyAsaasSignature(rawBody, token)) {
    throw new UnauthorizedException('Invalid webhook signature');
  }

  // 1. Persistir o receipt em payment_webhooks antes de qualquer outra escrita.
  // 2. Resolver o tenant pela cobrança (payment_request.external_id -> schoolId).
  await this.paymentWebhookService.registerReceipt(payload);

  // 3. Processar o evento de forma idempotente sem mudar o status HTTP depois do receipt.
  try {
    await this.paymentWebhookService.process(payload);
  } catch (error) {
    await this.paymentWebhookService.markAsFailed(payload, error);
  }
  // 4. 200 significa "recebido e registrado", mesmo se o processamento posterior falhar.
  return { received: true };
}
```

### Nunca DELETE em Tabelas Imutáveis

```typescript
// ✗ Proibido
await prisma.walletTransaction.delete(...)
await prisma.auditLog.delete(...)

// ✗ Proibido
await prisma.walletTransaction.update({ data: { amount: newAmount } })
```

---

## Erros e Exceções

```typescript
// ✓ Exceção de negócio com código identificável
throw new BusinessException('INSUFFICIENT_BALANCE', 'Saldo insuficiente para o pedido');

// ✓ Exceção de segurança
throw new UnauthorizedException('Você não tem permissão para acessar este recurso');

// ✓ Exceção de validação
throw new BadRequestException('O valor mínimo de recarga é R$ 10,00');

// ✗ Exceção genérica sem contexto
throw new Error('erro ao criar pedido');

// ✗ Swallow silencioso
try { ... } catch (e) { /* ignore */ }
```

---

## Logs

```typescript
// ✓ Log estruturado com contexto
this.logger.log({
  action: 'order.confirmed',
  orderId: order.id,
  schoolId: ctx.schoolId,
  totalAmount: order.totalAmount,
});

// ✗ Log com dados sensíveis
this.logger.log(`Usuário ${user.email} com senha ${dto.password} logou`);
this.logger.log(`Saldo atual: ${wallet.balance}, CPF: ${user.document}`);

// ✗ Console.log em código de produção
console.log('order created', order);
```

**Dados que NUNCA aparecem em logs:**
- Senhas ou hashes de senha
- Tokens JWT
- Dados de cartão de crédito
- CPF/documento completo
- Chaves de API

---

## DTOs e Validação

```typescript
// ✓ Sempre valide com class-validator
export class CreateOrderDto {
  @IsUUID()
  studentId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

// ✓ Resposta tipada — nunca retorne entidade do banco diretamente
export class OrderResponse {
  id: string;
  status: OrderStatus;
  totalAmount: number;
  createdAt: Date;
  // ← não inclui campos sensíveis ou desnecessários
}
```

---

## Nomenclatura

```typescript
// Arquivos: kebab-case
create-order.dto.ts
orders.service.ts

// Classes: PascalCase
class OrdersService {}
class CreateOrderDto {}

// Variáveis e funções: camelCase
const orderTotal = 0;
async createOrder() {}

// Constantes: UPPER_SNAKE_CASE
const MAX_ITEMS_PER_ORDER = 20;

// Enums: PascalCase com valores UPPER_SNAKE
enum OrderStatus {
  PENDING   = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}
```

---

## Testes

```typescript
// ✓ Teste descreve comportamento, não implementação
describe('OrdersService.create', () => {
  it('should throw INSUFFICIENT_BALANCE when wallet balance is less than order total')
  it('should reserve inventory for each order item')
  it('should create wallet transaction with correct idempotency key')
  it('should rollback entirely if inventory reservation fails')
})

// ✗ Teste descreve implementação
it('should call prisma.walletTransaction.create with the right parameters')
```

Toda regra de negócio tem pelo menos um teste.
Todo invariante tem teste de violação (o que acontece quando tenta violar).

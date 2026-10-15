/**
 * @jest-environment node
 */
import {
  createBindingSchema,
  createExchangeSchema,
  createQueueSchema,
  durationSeconds,
} from '@/modules/messaging-admin/messaging-admin.schemas'
import { MessagingAdminError, MessagingAdminService } from '@/modules/messaging-admin/messaging-admin.service'

jest.mock('@/lib/messaging/admin-client', () => ({
  getAdminClient: jest.fn(),
  getAdminConnectionString: () => 'Endpoint=sb://ns.servicebus.windows.net/;SharedAccessKeyName=k;SharedAccessKey=x',
}))

async function* iter<T>(items: T[]) {
  for (const item of items) yield item
}

function mockAdmin(overrides: Record<string, unknown> = {}) {
  return {
    createQueue: jest.fn().mockResolvedValue({}),
    deleteQueue: jest.fn().mockResolvedValue({}),
    createTopic: jest.fn().mockResolvedValue({}),
    deleteTopic: jest.fn().mockResolvedValue({}),
    createSubscription: jest.fn().mockResolvedValue({}),
    deleteSubscription: jest.fn().mockResolvedValue({}),
    listQueues: jest.fn(() => iter([{ name: 'tickets', maxDeliveryCount: 5, lockDuration: 'PT1M', defaultMessageTimeToLive: 'PT1H' }])),
    getQueueRuntimeProperties: jest.fn().mockResolvedValue({ activeMessageCount: 3, deadLetterMessageCount: 1 }),
    ...overrides,
  }
}

describe('validación de entradas (DTOs)', () => {
  it('rechaza una cola con nombre vacío', () => {
    expect(createQueueSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rechaza nombres con espacios, mayúsculas o muy cortos', () => {
    for (const name of ['mi cola', 'Tickets', 'ab', 'cola!', '-cola']) {
      expect(createQueueSchema.safeParse({ name }).success).toBe(false)
    }
  })

  it('rechaza el prefijo reservado del sistema', () => {
    const r = createQueueSchema.safeParse({ name: 'sv-tickets' })
    expect(r.success).toBe(false)
  })

  it('aplica valores por defecto a una cola válida', () => {
    expect(createQueueSchema.parse({ name: 'tickets' })).toEqual({
      name: 'tickets',
      maxDeliveryCount: 5,
      lockDuration: 'PT1M',
      defaultMessageTimeToLive: 'PT1H',
      deadLetteringOnMessageExpiration: true,
    })
  })

  it('rechaza reintentos y duraciones fuera de rango o mal formadas', () => {
    expect(createQueueSchema.safeParse({ name: 'tickets', maxDeliveryCount: 0 }).success).toBe(false)
    expect(createQueueSchema.safeParse({ name: 'tickets', lockDuration: 'PT10M' }).success).toBe(false)
    expect(createQueueSchema.safeParse({ name: 'tickets', lockDuration: '1 minuto' }).success).toBe(false)
  })

  it('rechaza campos desconocidos', () => {
    expect(createExchangeSchema.safeParse({ name: 'pedidos', extra: 1 }).success).toBe(false)
  })

  it('exige al menos una routing key y bloquea caracteres que permitirían inyectar SQL', () => {
    expect(createBindingSchema.safeParse({ name: 'auditoria', routingKeys: [] }).success).toBe(false)
    expect(createBindingSchema.safeParse({ name: 'auditoria', routingKeys: ["x') OR 1=1 --"] }).success).toBe(false)
    expect(createBindingSchema.safeParse({ name: 'auditoria', routingKeys: ['document.uploaded'] }).success).toBe(true)
  })

  it('convierte duraciones ISO 8601 a segundos', () => {
    expect(durationSeconds('PT1M')).toBe(60)
    expect(durationSeconds('P7D')).toBe(604_800)
    expect(Number.isNaN(durationSeconds('abc'))).toBe(true)
  })
})

describe('MessagingAdminService', () => {
  it('crea una cola con la configuración validada', async () => {
    const admin = mockAdmin()
    const service = new MessagingAdminService(admin as never)
    await service.createQueue(createQueueSchema.parse({ name: 'tickets', maxDeliveryCount: 3 }))
    expect(admin.createQueue).toHaveBeenCalledWith('tickets', expect.objectContaining({ maxDeliveryCount: 3, deadLetteringOnMessageExpiration: true }))
  })

  it('traduce "ya existe" del broker a 409', async () => {
    const admin = mockAdmin({ createQueue: jest.fn().mockRejectedValue({ statusCode: 409 }) })
    const service = new MessagingAdminService(admin as never)
    await expect(service.createQueue(createQueueSchema.parse({ name: 'tickets' }))).rejects.toMatchObject({ status: 409, code: 'already_exists' })
  })

  it('traduce "no existe" del broker a 404', async () => {
    const admin = mockAdmin({ deleteQueue: jest.fn().mockRejectedValue({ statusCode: 404 }) })
    const service = new MessagingAdminService(admin as never)
    await expect(service.deleteQueue('tickets')).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('protege las entidades del sistema', async () => {
    const admin = mockAdmin()
    const service = new MessagingAdminService(admin as never)
    await expect(service.deleteQueue('sv-rpc-requests')).rejects.toBeInstanceOf(MessagingAdminError)
    await expect(service.deleteExchange('sv-events')).rejects.toMatchObject({ code: 'protected_entity' })
    await expect(service.deleteBinding('sv-events', 'notifier')).rejects.toMatchObject({ code: 'protected_entity' })
    expect(admin.deleteQueue).not.toHaveBeenCalled()
    expect(admin.deleteTopic).not.toHaveBeenCalled()
    expect(admin.deleteSubscription).not.toHaveBeenCalled()
  })

  it('crea un binding como suscripción con regla SQL por routing key', async () => {
    const admin = mockAdmin()
    const service = new MessagingAdminService(admin as never)
    await service.createBinding('pedidos', createBindingSchema.parse({ name: 'auditoria', routingKeys: ['order.created', 'order.paid'] }))
    expect(admin.createSubscription).toHaveBeenCalledWith(
      'pedidos',
      'auditoria',
      expect.objectContaining({
        defaultRuleOptions: { name: 'by-subject', filter: { sqlExpression: "sys.Label IN ('order.created', 'order.paid')" } },
      })
    )
  })

  it('lista colas con mensajes activos y en DLQ', async () => {
    const service = new MessagingAdminService(mockAdmin() as never)
    await expect(service.listQueues()).resolves.toEqual([
      expect.objectContaining({ name: 'tickets', activeMessages: 3, deadLetterMessages: 1, system: false }),
    ])
  })
})

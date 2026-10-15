/**
 * @jest-environment node
 *
 * Integración del administrador de mensajería contra un broker real
 * (Azure Service Bus o el emulador). Se ejecuta solo con MQ_E2E=1 y
 * SERVICEBUS_ADMIN_CONNECTION_STRING (clave con permiso Manage).
 * Crea entidades con prefijo "e2e-" y las elimina al terminar.
 */
import { createBindingSchema, createExchangeSchema, createQueueSchema } from '@/modules/messaging-admin/messaging-admin.schemas'
import { MessagingAdminService } from '@/modules/messaging-admin/messaging-admin.service'

const describeWithBroker = process.env.MQ_E2E === '1' && process.env.SERVICEBUS_ADMIN_CONNECTION_STRING ? describe : describe.skip

const suffix = Date.now().toString(36)
const QUEUE = `e2e-tickets-${suffix}`
const EXCHANGE = `e2e-pedidos-${suffix}`
const BINDING = `e2e-auditoria-${suffix}`

describeWithBroker('Administrador de mensajería (broker real)', () => {
  jest.setTimeout(60_000)
  // Se crea en beforeAll: el cuerpo de describe se evalúa aunque la suite esté omitida,
  // y sin broker configurado el constructor fallaría (p. ej. en CI).
  let service: MessagingAdminService
  beforeAll(() => {
    service = new MessagingAdminService()
  })

  afterAll(async () => {
    await service.deleteQueue(QUEUE).catch(() => {})
    await service.deleteExchange(EXCHANGE).catch(() => {})
  })

  it('crea una cola, la lista con sus contadores y la elimina', async () => {
    await service.createQueue(createQueueSchema.parse({ name: QUEUE, maxDeliveryCount: 3 }))
    const queues = await service.listQueues()
    expect(queues).toEqual(expect.arrayContaining([expect.objectContaining({ name: QUEUE, maxDeliveryCount: 3, deadLetterMessages: 0 })]))
    await service.deleteQueue(QUEUE)
    expect((await service.listQueues()).map((q) => q.name)).not.toContain(QUEUE)
  })

  it('rechaza crear una cola que ya existe (409) y borrar una que no existe (404)', async () => {
    await service.createQueue(createQueueSchema.parse({ name: QUEUE }))
    await expect(service.createQueue(createQueueSchema.parse({ name: QUEUE }))).rejects.toMatchObject({ status: 409 })
    await service.deleteQueue(QUEUE)
    await expect(service.deleteQueue(QUEUE)).rejects.toMatchObject({ status: 404 })
  })

  it('crea un exchange con un binding filtrado por routing keys y los elimina', async () => {
    await service.createExchange(createExchangeSchema.parse({ name: EXCHANGE }))
    await service.createBinding(EXCHANGE, createBindingSchema.parse({ name: BINDING, routingKeys: ['order.created', 'order.paid'] }))

    const bindings = await service.listBindings(EXCHANGE)
    expect(bindings).toEqual([expect.objectContaining({ name: BINDING, routingKeys: ['order.created', 'order.paid'] })])
    expect((await service.listExchanges()).find((e) => e.name === EXCHANGE)?.bindings).toEqual([BINDING])

    await service.deleteBinding(EXCHANGE, BINDING)
    expect(await service.listBindings(EXCHANGE)).toEqual([])
    await service.deleteExchange(EXCHANGE)
  })

  it('no permite eliminar las entidades que usa la app', async () => {
    await expect(service.deleteExchange('sv-events')).rejects.toMatchObject({ status: 409, code: 'protected_entity' })
    await expect(service.deleteBinding('sv-events', 'indexer')).rejects.toMatchObject({ code: 'protected_entity' })
    expect((await service.listExchanges()).map((e) => e.name)).toContain('sv-events')
  })
})

/**
 * MessagingAdminService — administración dinámica del broker (Azure Service Bus).
 *
 * Servicio dedicado: los controladores (API Routes) solo validan la entrada y
 * delegan aquí. Equivalencias con RabbitMQ, que es lo que usa el material:
 *   - cola     → cola de Service Bus (con su DLQ incorporada)
 *   - exchange → topic
 *   - binding  → suscripción del topic con una regla SQL que filtra por la
 *                clave de enrutamiento (el `subject` del mensaje)
 *
 * Las entidades del sistema (prefijo "sv-" y las suscripciones que consume la
 * app) no se pueden eliminar desde aquí, para no romper la mensajería existente.
 */

import type { ServiceBusAdministrationClient } from '@azure/service-bus'
import { getAdminClient, getAdminConnectionString } from '@/lib/messaging/admin-client'
import { flavorFromConnectionString, SUB_INDEXER, SUB_NOTIFIER, SUBJECT_RULE, TOPIC_EVENTS } from '@/lib/messaging/topology'
import {
  RESERVED_PREFIX,
  type CreateBindingInput,
  type CreateExchangeInput,
  type CreateQueueInput,
} from './messaging-admin.schemas'

export class MessagingAdminError extends Error {
  constructor(
    public readonly status: 404 | 409 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'MessagingAdminError'
  }
}

const SYSTEM_SUBSCRIPTIONS = new Set([SUB_INDEXER, SUB_NOTIFIER])

export interface QueueSummary {
  name: string
  activeMessages: number
  deadLetterMessages: number
  maxDeliveryCount: number
  lockDuration: string
  defaultMessageTimeToLive: string
  system: boolean
}

export interface BindingSummary {
  name: string
  routingKeys: string[]
  maxDeliveryCount: number
  system: boolean
}

export interface ExchangeSummary {
  name: string
  defaultMessageTimeToLive: string
  bindings: string[]
  system: boolean
}

const isSystemName = (name: string) => name.startsWith(RESERVED_PREFIX)

/** Traduce los errores del SDK (RestError con statusCode) a errores de dominio con su código HTTP. */
function mapSdkError(error: unknown, kind: string, name: string): never {
  const e = error as { statusCode?: number; code?: string }
  if (e?.statusCode === 409 || e?.code === 'MessageEntityAlreadyExistsError') {
    throw new MessagingAdminError(409, 'already_exists', `${kind} "${name}" ya existe`)
  }
  if (e?.statusCode === 404 || e?.code === 'MessageEntityNotFoundError') {
    throw new MessagingAdminError(404, 'not_found', `${kind} "${name}" no existe`)
  }
  throw error
}

/** El emulador crea la entidad pero a veces responde un XML que el SDK no entiende (PARSE_ERROR). */
function isEmulatorParseQuirk(error: unknown): boolean {
  return (
    flavorFromConnectionString(getAdminConnectionString()) === 'emulator' &&
    (error as { code?: string })?.code === 'PARSE_ERROR'
  )
}

/** Extrae las claves de "sys.Label IN ('a', 'b')" para mostrarlas como routing keys. */
function routingKeysFromSql(sql: string | undefined): string[] {
  return Array.from((sql ?? '').matchAll(/'([^']+)'/g), (m) => m[1])
}

export class MessagingAdminService {
  constructor(private readonly admin: ServiceBusAdministrationClient = getAdminClient()) {}

  // ── Colas ───────────────────────────────────────────────────

  async listQueues(): Promise<QueueSummary[]> {
    const result: QueueSummary[] = []
    for await (const q of this.admin.listQueues()) {
      const runtime = await this.admin.getQueueRuntimeProperties(q.name)
      result.push({
        name: q.name,
        activeMessages: runtime.activeMessageCount,
        deadLetterMessages: runtime.deadLetterMessageCount,
        maxDeliveryCount: q.maxDeliveryCount,
        lockDuration: q.lockDuration,
        defaultMessageTimeToLive: q.defaultMessageTimeToLive,
        system: isSystemName(q.name),
      })
    }
    return result
  }

  async createQueue(input: CreateQueueInput): Promise<{ name: string }> {
    try {
      await this.admin.createQueue(input.name, {
        maxDeliveryCount: input.maxDeliveryCount,
        lockDuration: input.lockDuration,
        defaultMessageTimeToLive: input.defaultMessageTimeToLive,
        deadLetteringOnMessageExpiration: input.deadLetteringOnMessageExpiration,
      })
    } catch (error) {
      if (!isEmulatorParseQuirk(error)) mapSdkError(error, 'La cola', input.name)
    }
    return { name: input.name }
  }

  async deleteQueue(name: string): Promise<void> {
    if (isSystemName(name)) {
      throw new MessagingAdminError(409, 'protected_entity', `La cola "${name}" es del sistema y no se puede eliminar`)
    }
    try {
      await this.admin.deleteQueue(name)
    } catch (error) {
      mapSdkError(error, 'La cola', name)
    }
  }

  // ── Exchanges (topics) ──────────────────────────────────────

  async listExchanges(): Promise<ExchangeSummary[]> {
    const result: ExchangeSummary[] = []
    for await (const t of this.admin.listTopics()) {
      const bindings: string[] = []
      for await (const s of this.admin.listSubscriptions(t.name)) bindings.push(s.subscriptionName)
      result.push({
        name: t.name,
        defaultMessageTimeToLive: t.defaultMessageTimeToLive,
        bindings,
        system: isSystemName(t.name),
      })
    }
    return result
  }

  async createExchange(input: CreateExchangeInput): Promise<{ name: string }> {
    try {
      await this.admin.createTopic(input.name, { defaultMessageTimeToLive: input.defaultMessageTimeToLive })
    } catch (error) {
      if (!isEmulatorParseQuirk(error)) mapSdkError(error, 'El exchange', input.name)
    }
    return { name: input.name }
  }

  async deleteExchange(name: string): Promise<void> {
    if (isSystemName(name)) {
      throw new MessagingAdminError(409, 'protected_entity', `El exchange "${name}" es del sistema y no se puede eliminar`)
    }
    try {
      await this.admin.deleteTopic(name)
    } catch (error) {
      mapSdkError(error, 'El exchange', name)
    }
  }

  // ── Bindings (suscripciones con filtro por routing key) ─────

  async listBindings(exchange: string): Promise<BindingSummary[]> {
    const result: BindingSummary[] = []
    try {
      for await (const s of this.admin.listSubscriptions(exchange)) {
        const rule = await this.admin.getRule(exchange, s.subscriptionName, SUBJECT_RULE).catch(() => null)
        const filter = rule?.filter as { sqlExpression?: string } | undefined
        result.push({
          name: s.subscriptionName,
          routingKeys: routingKeysFromSql(filter?.sqlExpression),
          maxDeliveryCount: s.maxDeliveryCount,
          system: exchange === TOPIC_EVENTS && SYSTEM_SUBSCRIPTIONS.has(s.subscriptionName),
        })
      }
    } catch (error) {
      mapSdkError(error, 'El exchange', exchange)
    }
    return result
  }

  async createBinding(exchange: string, input: CreateBindingInput): Promise<{ name: string; routingKeys: string[] }> {
    // Las claves ya vienen validadas (sin comillas): se pueden interpolar en la regla SQL sin riesgo de inyección.
    const sqlExpression = `sys.Label IN (${input.routingKeys.map((k) => `'${k}'`).join(', ')})`
    try {
      await this.admin.createSubscription(exchange, input.name, {
        maxDeliveryCount: input.maxDeliveryCount,
        lockDuration: input.lockDuration,
        deadLetteringOnMessageExpiration: input.deadLetteringOnMessageExpiration,
        defaultRuleOptions: { name: SUBJECT_RULE, filter: { sqlExpression } },
      })
    } catch (error) {
      if (!isEmulatorParseQuirk(error)) mapSdkError(error, `El binding en "${exchange}"`, input.name)
    }
    return { name: input.name, routingKeys: input.routingKeys }
  }

  async deleteBinding(exchange: string, name: string): Promise<void> {
    if (exchange === TOPIC_EVENTS && SYSTEM_SUBSCRIPTIONS.has(name)) {
      throw new MessagingAdminError(409, 'protected_entity', `El binding "${name}" lo usa la app y no se puede eliminar`)
    }
    try {
      await this.admin.deleteSubscription(exchange, name)
    } catch (error) {
      mapSdkError(error, `El binding en "${exchange}"`, name)
    }
  }
}

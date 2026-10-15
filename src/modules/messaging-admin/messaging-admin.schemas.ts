/**
 * Validación de entradas de la API de administración de mensajería
 * (equivalente a los DTOs con anotaciones de validación en Spring).
 *
 * Impide crear entidades con nombres vacíos o inválidos, configuraciones fuera
 * de rango y filtros de enrutamiento que permitan inyectar SQL en la regla.
 */

import { z } from 'zod'

/** Prefijo reservado para las entidades que usa la propia app (sv-events, sv-rpc-*). */
export const RESERVED_PREFIX = 'sv-'

/** 3–50 caracteres: minúsculas, números, punto, guion o guion bajo; empieza y termina en letra o número. */
const ENTITY_NAME = /^[a-z0-9][a-z0-9._-]{1,48}[a-z0-9]$/

/** "PT30S", "PT5M", "P7D"… (ISO 8601). */
const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

export function durationSeconds(iso: string): number {
  const match = iso.match(ISO_DURATION)
  if (!match || iso === 'P' || iso.endsWith('T')) return NaN
  const [, d = '0', h = '0', m = '0', s = '0'] = match
  return Number(d) * 86_400 + Number(h) * 3_600 + Number(m) * 60 + Number(s)
}

const duration = (label: string, minSeconds: number, maxSeconds: number) =>
  z
    .string({ required_error: `${label} es obligatorio` })
    .refine((v) => !Number.isNaN(durationSeconds(v)), `${label} debe ser una duración ISO 8601 (ej. PT1M, P7D)`)
    .refine((v) => {
      const s = durationSeconds(v)
      return s >= minSeconds && s <= maxSeconds
    }, `${label} debe estar entre ${minSeconds} s y ${maxSeconds} s`)

export const entityNameSchema = z
  .string({ required_error: 'El nombre es obligatorio' })
  .trim()
  .min(1, 'El nombre no puede estar vacío')
  .regex(ENTITY_NAME, 'Nombre inválido: 3–50 caracteres, minúsculas, números, ".", "-" o "_", sin espacios')

/** Nombre de una entidad nueva: además de válido, no puede usar el prefijo reservado del sistema. */
const newEntityName = entityNameSchema.refine(
  (name) => !name.startsWith(RESERVED_PREFIX),
  `El prefijo "${RESERVED_PREFIX}" está reservado para las entidades del sistema`
)

/** Clave de enrutamiento (tipo de evento): sin comillas ni espacios, así no se puede inyectar SQL en el filtro. */
export const routingKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9.-]{0,99}$/, 'Clave de enrutamiento inválida: minúsculas, números, "." o "-" (ej. document.uploaded)')

export const createQueueSchema = z
  .object({
    name: newEntityName,
    maxDeliveryCount: z.number().int().min(1).max(100).default(5),
    lockDuration: duration('lockDuration', 5, 300).default('PT1M'),
    defaultMessageTimeToLive: duration('defaultMessageTimeToLive', 60, 14 * 86_400).default('PT1H'),
    deadLetteringOnMessageExpiration: z.boolean().default(true),
  })
  .strict()

export const createExchangeSchema = z
  .object({
    name: newEntityName,
    defaultMessageTimeToLive: duration('defaultMessageTimeToLive', 60, 14 * 86_400).default('PT1H'),
  })
  .strict()

export const createBindingSchema = z
  .object({
    name: newEntityName,
    routingKeys: z.array(routingKeySchema).min(1, 'Debe indicar al menos una clave de enrutamiento').max(20),
    maxDeliveryCount: z.number().int().min(1).max(100).default(5),
    lockDuration: duration('lockDuration', 5, 300).default('PT1M'),
    deadLetteringOnMessageExpiration: z.boolean().default(true),
  })
  .strict()

export type CreateQueueInput = z.infer<typeof createQueueSchema>
export type CreateExchangeInput = z.infer<typeof createExchangeSchema>
export type CreateBindingInput = z.infer<typeof createBindingSchema>

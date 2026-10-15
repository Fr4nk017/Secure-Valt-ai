/**
 * admin-client.ts — Cliente de administración de Azure Service Bus.
 *
 * Crea y elimina entidades (colas, topics, suscripciones). Necesita una clave
 * con permiso Manage: SERVICEBUS_ADMIN_CONNECTION_STRING, o en su defecto la
 * connection string de la app (en el emulador local ya trae RootManageSharedAccessKey).
 *
 * El emulador expone la API de administración por HTTP en el puerto 5300 y el
 * SDK siempre habla HTTPS, así que se reescribe la URL de cada petición
 * (mismo enfoque que scripts/servicebus-provision.ts).
 */

import { ServiceBusAdministrationClient } from '@azure/service-bus'
import { flavorFromConnectionString } from './topology'

const EMULATOR_MANAGEMENT_PORT = 5300

const globalForAdmin = globalThis as unknown as { svAdminClient?: ServiceBusAdministrationClient }

export function getAdminConnectionString(): string {
  return process.env.SERVICEBUS_ADMIN_CONNECTION_STRING ?? process.env.SERVICEBUS_CONNECTION_STRING ?? ''
}

export function isAdminEnabled(): boolean {
  return Boolean(getAdminConnectionString())
}

export function getAdminClient(): ServiceBusAdministrationClient {
  const connectionString = getAdminConnectionString()
  if (!connectionString) throw new Error('SERVICEBUS_ADMIN_CONNECTION_STRING no está configurada')

  if (!globalForAdmin.svAdminClient) {
    if (flavorFromConnectionString(connectionString) === 'emulator') {
      const admin = new ServiceBusAdministrationClient(
        connectionString.replace(/Endpoint=sb:\/\/([^;:/]+)[^;]*/i, `Endpoint=sb://$1:${EMULATOR_MANAGEMENT_PORT}`)
      )
      admin.pipeline.addPolicy(
        {
          name: 'emulatorHttpPolicy',
          sendRequest(request, next) {
            request.url = request.url.replace(/^https:/, 'http:')
            request.allowInsecureConnection = true
            return next(request)
          },
        },
        { afterPhase: 'Sign' }
      )
      globalForAdmin.svAdminClient = admin
    } else {
      globalForAdmin.svAdminClient = new ServiceBusAdministrationClient(connectionString)
    }
  }
  return globalForAdmin.svAdminClient
}

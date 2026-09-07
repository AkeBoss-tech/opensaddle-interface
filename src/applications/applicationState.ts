export type ApplicationStateValue = string | number | boolean
export type ApplicationState = Record<string, ApplicationStateValue>
export type ApplicationStateProperty = { type: 'string' | 'number' | 'boolean'; maxLength?: number; minimum?: number; maximum?: number }
export type ApplicationStateSchema = { type: 'object'; additionalProperties: false; maxProperties: number; properties: Record<string, ApplicationStateProperty>; required?: string[] }
export type ApplicationStateMigration = { from_version: number; to_version: number; operations: Array<{ op: 'rename'; from: string; to: string } | { op: 'drop'; path: string } | { op: 'set_default'; path: string; value: ApplicationStateValue }> }

const keyPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)
const exact = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))
const encodedSize = (value: unknown) => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength }
  catch { return Infinity }
}
const reservedKeys = new Set(['__proto__', 'constructor', 'prototype'])
const validKey = (value: unknown): value is string => typeof value === 'string' && keyPattern.test(value) && !reservedKeys.has(value)

export function validateApplicationStateSchema(value: unknown): ApplicationStateSchema | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exact(value, ['type', 'additionalProperties', 'maxProperties', 'properties', 'required'])) return
  const schema = value as Partial<ApplicationStateSchema>
  if (schema.type !== 'object' || schema.additionalProperties !== false || !Number.isInteger(schema.maxProperties) || schema.maxProperties! < 0 || schema.maxProperties! > 32) return
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return
  const entries = Object.entries(schema.properties)
  if (entries.length > schema.maxProperties! || entries.some(([key]) => !validKey(key))) return
  for (const [, property] of entries) {
    if (!property || typeof property !== 'object' || !exact(property, ['type', 'maxLength', 'minimum', 'maximum']) || !['string', 'number', 'boolean'].includes(property.type)) return
    if (property.type === 'string' && (!Number.isInteger(property.maxLength) || property.maxLength! < 0 || property.maxLength! > 4096)) return
    if (property.type !== 'string' && property.maxLength !== undefined) return
    if (property.type === 'number' && (!Number.isFinite(property.minimum) || !Number.isFinite(property.maximum))) return
    if (property.minimum !== undefined && (!Number.isFinite(property.minimum) || property.type !== 'number')) return
    if (property.maximum !== undefined && (!Number.isFinite(property.maximum) || property.type !== 'number')) return
    if (property.minimum !== undefined && property.maximum !== undefined && property.minimum > property.maximum) return
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length || schema.required.some(key => !validKey(key) || !own(schema.properties!, key)))) return
  return encodedSize(schema) <= 16_384 ? schema as ApplicationStateSchema : undefined
}

export function validateApplicationState(value: unknown, schemaValue: unknown): ApplicationState | undefined {
  const schema = validateApplicationStateSchema(schemaValue)
  if (!schema || !value || typeof value !== 'object' || Array.isArray(value)) return
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length > schema.maxProperties || keys.some(key => !own(schema.properties, key)) || schema.required?.some(key => !own(record, key))) return
  for (const [key, item] of Object.entries(record)) {
    const property = schema.properties[key]!
    if (typeof item !== property.type) return
    if (typeof item === 'string' && Array.from(item).length > property.maxLength!) return
    if (typeof item === 'number' && (!Number.isFinite(item) || property.minimum !== undefined && item < property.minimum || property.maximum !== undefined && item > property.maximum)) return
  }
  return encodedSize(record) <= 8192 ? record as ApplicationState : undefined
}

export function validateApplicationStateMigration(value: unknown, targetSchemaValue?: unknown, targetVersion?: number): ApplicationStateMigration | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exact(value, ['from_version', 'to_version', 'operations'])) return
  const migration = value as Partial<ApplicationStateMigration>
  if (!Number.isInteger(migration.from_version) || migration.from_version! < 1 || !Number.isInteger(migration.to_version) || migration.to_version! < 1 || migration.from_version === migration.to_version) return
  if (!Array.isArray(migration.operations) || migration.operations.length > 16) return
  if (targetVersion !== undefined && migration.to_version !== targetVersion) return
  const targetSchema = targetSchemaValue === undefined ? undefined : validateApplicationStateSchema(targetSchemaValue)
  if (targetSchemaValue !== undefined && !targetSchema) return
  const destinations = new Set<string>()
  for (const operation of migration.operations) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) || !own(operation, 'op')) return
    if (operation.op === 'rename') {
      if (!exact(operation, ['op', 'from', 'to']) || !validKey(operation.from) || !validKey(operation.to) || operation.from === operation.to) return
    } else if (operation.op === 'drop') {
      if (!exact(operation, ['op', 'path']) || !validKey(operation.path)) return
    } else if (operation.op === 'set_default') {
      if (!exact(operation, ['op', 'path', 'value']) || !validKey(operation.path) || !own(operation, 'value') || !['string', 'number', 'boolean'].includes(typeof operation.value)) return
      if (typeof operation.value === 'number' && !Number.isFinite(operation.value)) return
    } else return
    const destination = operation.op === 'rename' ? operation.to : operation.op === 'set_default' ? operation.path : undefined
    if (destination) {
      if (destinations.has(destination) || targetSchema && !own(targetSchema.properties, destination)) return
      destinations.add(destination)
      if (operation.op === 'set_default' && targetSchema) {
        const property = targetSchema.properties[destination]!
        if (typeof operation.value !== property.type) return
        if (typeof operation.value === 'string' && Array.from(operation.value).length > property.maxLength!) return
        if (typeof operation.value === 'number' && (operation.value < property.minimum! || operation.value > property.maximum!)) return
      }
    }
  }
  return encodedSize(migration) <= 16_384 ? migration as ApplicationStateMigration : undefined
}

export function migrateApplicationState(value: unknown, sourceSchema: unknown, targetSchema: unknown, migrationValue: unknown): ApplicationState | undefined {
  const source = validateApplicationState(value, sourceSchema)
  const migration = validateApplicationStateMigration(migrationValue, targetSchema)
  if (!source || !migration) return
  const next: ApplicationState = { ...source }
  for (const operation of migration.operations) {
    if (operation.op === 'rename') {
      if (own(next, operation.to)) return
      if (own(next, operation.from)) { next[operation.to] = next[operation.from]!; delete next[operation.from] }
    } else if (operation.op === 'drop') delete next[operation.path]
    else if (!own(next, operation.path)) next[operation.path] = operation.value
  }
  return validateApplicationState(next, targetSchema)
}

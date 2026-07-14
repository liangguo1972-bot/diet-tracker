type SupabaseLikeError = { code?: string; message: string }

export type Fr002ErrorCode =
  | 'INVALID_REFERENCE'
  | 'QUANTITY_INVALID'
  | 'UNIT_CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NETWORK_UNKNOWN'

const fr002Messages: Record<Fr002ErrorCode, string> = {
  INVALID_REFERENCE: '所选数据已经失效，请重新加载后选择。',
  QUANTITY_INVALID: '数量、日期或输入格式不正确，请检查后重试。',
  UNIT_CONFLICT: '使用量的单位与库存批次不一致，请选择同单位库存。',
  INSUFFICIENT_STOCK: '库存不足，整次保存没有生效。请调整用量后重试。',
  CONFLICT: '数据状态已经变化，请重新加载后决定是否继续。',
  IDEMPOTENCY_CONFLICT: '同一次操作的内容已经变化，请先确认原操作结果。',
  NETWORK_UNKNOWN: '网络中断，服务端结果暂时未知。草稿和本次操作编号已保留。',
}

export class Fr002Error extends Error {
  constructor(public readonly code: Fr002ErrorCode) {
    super(fr002Messages[code])
    this.name = 'Fr002Error'
  }
}

export class AuthenticationRequiredError extends Error {
  constructor(message = '登录状态已失效，请重新登录。') {
    super(message)
    this.name = 'AuthenticationRequiredError'
  }
}

export class MealComponentNotFoundError extends Error {
  constructor() {
    super('所选成品或单品已不可用，请删除后重新选择。')
    this.name = 'MealComponentNotFoundError'
  }
}

export class MealNotFoundError extends Error {
  constructor() {
    super('这餐已经不存在。')
    this.name = 'MealNotFoundError'
  }
}

export function toDataError(error: SupabaseLikeError): Error {
  if (error.code === '28000' || /AUTH_REQUIRED|FORBIDDEN|authentication required|jwt|not authenticated|permission denied for function/i.test(error.message)) {
    return new AuthenticationRequiredError()
  }
  const code = (['INVALID_REFERENCE', 'QUANTITY_INVALID', 'UNIT_CONFLICT', 'INSUFFICIENT_STOCK', 'CONFLICT', 'IDEMPOTENCY_CONFLICT'] as const)
    .find((candidate) => error.message.includes(candidate))
  if (code) return new Fr002Error(code)
  if (/selectable ingredient not found|cook session not found/i.test(error.message)) return new MealComponentNotFoundError()
  if (/meal not found/i.test(error.message)) return new MealNotFoundError()
  return new Error(error.message)
}

export function toOperationError(reason: unknown): Error {
  if (reason instanceof AuthenticationRequiredError || reason instanceof Fr002Error) return reason
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const error = reason as SupabaseLikeError
    const mapped = toDataError(error)
    if (mapped.constructor !== Error) return mapped
    if (/failed to fetch|fetch failed|network|load failed|connection|timeout/i.test(error.message)) return new Fr002Error('NETWORK_UNKNOWN')
    return mapped
  }
  return new Fr002Error('NETWORK_UNKNOWN')
}

export function isAuthenticationRequired(error: unknown): error is AuthenticationRequiredError {
  return error instanceof AuthenticationRequiredError
}

export function isMealComponentNotFound(error: unknown): error is MealComponentNotFoundError {
  return error instanceof MealComponentNotFoundError
}

export function isMealNotFound(error: unknown): error is MealNotFoundError {
  return error instanceof MealNotFoundError
}

export function isFr002Error(error: unknown, code?: Fr002ErrorCode): error is Fr002Error {
  return error instanceof Fr002Error && (code === undefined || error.code === code)
}

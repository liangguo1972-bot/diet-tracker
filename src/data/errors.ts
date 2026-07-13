type SupabaseLikeError = { code?: string; message: string }

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
  if (error.code === '28000' || /authentication required|jwt|not authenticated|permission denied for function/i.test(error.message)) {
    return new AuthenticationRequiredError()
  }
  if (/selectable ingredient not found|cook session not found/i.test(error.message)) return new MealComponentNotFoundError()
  if (/meal not found/i.test(error.message)) return new MealNotFoundError()
  return new Error(error.message)
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

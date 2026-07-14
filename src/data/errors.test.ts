import { describe, expect, it } from 'vitest'
import { AuthenticationRequiredError, Fr002Error, MealComponentNotFoundError, MealNotFoundError, toDataError, toOperationError } from './errors'

describe('RPC error semantics', () => {
  it('treats PostgREST function permission errors as expired auth', () => {
    expect(toDataError({ message: 'permission denied for function get_today' })).toBeInstanceOf(AuthenticationRequiredError)
  })

  it('asks the user to reselect an invalid component', () => {
    expect(toDataError({ message: 'Selectable ingredient not found' })).toBeInstanceOf(MealComponentNotFoundError)
    expect(toDataError({ message: 'Cook session not found' })).toBeInstanceOf(MealComponentNotFoundError)
  })

  it('closes editing when the meal no longer exists', () => {
    expect(toDataError({ message: 'Meal not found' })).toBeInstanceOf(MealNotFoundError)
  })

  it('maps stable FR-002 business codes', () => {
    expect(toDataError({ message: 'UNIT_CONFLICT' })).toMatchObject({ code: 'UNIT_CONFLICT' })
    expect(toDataError({ message: 'INSUFFICIENT_STOCK' })).toMatchObject({ code: 'INSUFFICIENT_STOCK' })
  })

  it('maps an unknown mutation network result without losing the operation semantics', () => {
    const error = toOperationError(new Error('Failed to fetch'))
    expect(error).toBeInstanceOf(Fr002Error)
    expect(error).toMatchObject({ code: 'NETWORK_UNKNOWN' })
  })
})

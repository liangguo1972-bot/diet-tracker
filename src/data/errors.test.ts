import { describe, expect, it } from 'vitest'
import { AuthenticationRequiredError, MealComponentNotFoundError, MealNotFoundError, toDataError } from './errors'

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
})

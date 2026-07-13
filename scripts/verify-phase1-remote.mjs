import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CLI = process.env.SUPABASE_CLI_PATH
  ?? `${process.env.HOME}/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/dist/supabase.js`
const PROJECT_REF = 'hgefanuytaryfhsybvhf'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const TEST_DATE = '2026-07-12'
const DUPLICATE_DATE = '2026-07-11'
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
const password = `Dt!${randomBytes(18).toString('base64url')}`
const results = []

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `: ${JSON.stringify(details)}` : ''
    throw new Error(`${message}${suffix}`)
  }
}

function approx(actual, expected, label) {
  assert(Math.abs(Number(actual) - expected) < 0.00001, `${label} expected ${expected}, got ${actual}`)
}

function log(name, details = {}) {
  results.push({ name, status: 'passed', ...details })
}

function getApiKeys() {
  const output = execFileSync('node', [
    CLI,
    'projects',
    'api-keys',
    '--project-ref',
    PROJECT_REF,
    '--reveal',
    '--output',
    'json',
  ], { encoding: 'utf8' })
  const keys = JSON.parse(output)
  const anon = keys.find((key) => key.id === 'anon' || key.type === 'publishable')?.api_key
  const serviceRole = keys.find((key) => key.id === 'service_role' || key.type === 'secret')?.api_key

  assert(anon, 'Could not obtain a publishable API key')
  assert(serviceRole && !serviceRole.includes('···'), 'Could not obtain a full service-role API key')
  return { anon, serviceRole }
}

function makeClient(key) {
  return createClient(PROJECT_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireData(operation) {
  const { data, error } = await operation
  assert(!error, 'Supabase operation failed', { message: error?.message, code: error?.code })
  return data
}

async function signIn(anon, email) {
  const client = makeClient(anon)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  assert(!error && data.session, 'Test user login failed', { message: error?.message })
  return client
}

async function createTestUser(admin, suffix) {
  const email = `diet-tracker-${suffix}-${runId}@example.invalid`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: 'phase1-contract-verification', runId },
  })
  assert(!error && data.user, 'Could not create test user', { message: error?.message })
  return { id: data.user.id, email }
}

async function mealCount(client, date) {
  const { count, error } = await client
    .from('meals')
    .select('id', { count: 'exact', head: true })
    .eq('eaten_on', date)
  assert(!error, 'Could not count meals', { message: error?.message })
  return count ?? 0
}

async function getToday(client, date) {
  return requireData(client.rpc('get_today', { p_date: date }))
}

async function saveMeal(client, { date, mealType, note = '', items }) {
  return client.rpc('save_meal', {
    p_eaten_on: date,
    p_meal_type: mealType,
    p_note: note,
    p_items: items,
  })
}

async function main() {
  const { anon, serviceRole } = getApiKeys()
  const admin = makeClient(serviceRole)
  const userA = await createTestUser(admin, 'rpc-a')
  const userB = await createTestUser(admin, 'rpc-b')
  const a = await signIn(anon, userA.email)
  const b = await signIn(anon, userB.email)

  const emptyToday = await getToday(b, TEST_DATE)
  assert(emptyToday.date === TEST_DATE, 'get_today returned a different date')
  assert(emptyToday.meals.length === 0, 'New user should have no meals')
  assert(emptyToday.target.kcal === null && emptyToday.target.protein === null, 'Missing target should return null values')
  for (const key of ['kcal', 'protein', 'carb', 'fat']) approx(emptyToday.total[key], 0, `empty total.${key}`)
  log('get_today: empty day and null target')

  await requireData(a.from('targets').insert({ daily_kcal: 2100, daily_protein_g: 120 }).select('id').single())

  const verifiedIngredient = await requireData(a.from('ingredients').insert({
    name: `TEST 已验证燕麦 ${runId}`,
    category: '测试已验证单品',
    kcal_per_100g: 120,
    protein_per_100g: 12,
    carb_per_100g: 10,
    fat_per_100g: 4,
    serving_grams: 50,
    is_verified: true,
  }).select().single())

  const estimatedIngredient = await requireData(a.from('ingredients').insert({
    name: `TEST 估算莓果 ${runId}`,
    category: '测试估算单品',
    kcal_per_100g: 80,
    protein_per_100g: 4,
    carb_per_100g: 16,
    fat_per_100g: 2,
    serving_grams: 25,
    is_verified: false,
  }).select().single())

  const activeCook = await requireData(a.from('cook_sessions').insert({
    name: `TEST 成品有剩余 ${runId}`,
    cooked_on: TEST_DATE,
    total_servings: 2,
  }).select().single())
  await requireData(a.from('cook_items').insert([
    { cook_session_id: activeCook.id, ingredient_id: verifiedIngredient.id, grams: 100 },
    { cook_session_id: activeCook.id, ingredient_id: estimatedIngredient.id, grams: 100 },
  ]).select('id'))

  const exhaustedCook = await requireData(a.from('cook_sessions').insert({
    name: `TEST 成品无剩余 ${runId}`,
    cooked_on: TEST_DATE,
    total_servings: 1,
  }).select().single())
  await requireData(a.from('cook_items').insert({
    cook_session_id: exhaustedCook.id,
    ingredient_id: verifiedIngredient.id,
    grams: 100,
  }).select('id'))

  const saveResult = await saveMeal(a, {
    date: TEST_DATE,
    mealType: '午餐',
    note: 'TEST 午餐备注',
    items: [
      { sourceType: 'cook_session', cookSessionId: activeCook.id, servings: 1 },
      { sourceType: 'ingredient', ingredientId: verifiedIngredient.id, servings: 2 },
    ],
  })
  assert(!saveResult.error && saveResult.data, 'save_meal should save a complete meal', { message: saveResult.error?.message })
  const mainMealId = saveResult.data
  log('save_meal: successful complete meal')

  const exhaustResult = await saveMeal(a, {
    date: TEST_DATE,
    mealType: '加餐',
    note: 'TEST 用尽成品',
    items: [{ sourceType: 'cook_session', cookSessionId: exhaustedCook.id, servings: 1 }],
  })
  assert(!exhaustResult.error, 'Could not create exhausted-cook test meal', { message: exhaustResult.error?.message })

  const todayAfterSave = await getToday(a, TEST_DATE)
  assert(todayAfterSave.target.kcal === 2100 && todayAfterSave.target.protein === 120, 'Configured target is incorrect')
  const savedMeal = todayAfterSave.meals.find((meal) => meal.id === mainMealId)
  assert(savedMeal?.note === 'TEST 午餐备注', 'Meal note was not returned')
  assert(savedMeal.items.length === 2, 'Saved meal should contain two items')
  assert(savedMeal.items[0].sourceType === 'cook_session' && savedMeal.items[1].sourceType === 'ingredient', 'Meal items are not ordered by position')
  assert(savedMeal.items[0].estimated === true && savedMeal.items[1].estimated === false, 'Estimated flags are incorrect')
  approx(savedMeal.nutrition.kcal, 220, 'saved meal kcal')
  approx(savedMeal.nutrition.protein, 20, 'saved meal protein')
  approx(savedMeal.nutrition.carb, 23, 'saved meal carb')
  approx(savedMeal.nutrition.fat, 7, 'saved meal fat')
  log('get_today: note, order, nutrition and estimated flags')

  const cooks = await requireData(a.rpc('search_meal_components', { p_source_type: 'cook_session', p_query: '有剩余' }))
  const activeRow = cooks.find((row) => row.source_id === activeCook.id)
  assert(activeRow, 'Active cook session was not returned by keyword search')
  assert(activeRow.subtitle === `做好于 ${TEST_DATE}`, 'Cook subtitle is incorrect')
  approx(activeRow.available_servings, 1, 'available servings')
  assert(activeRow.last_used_on === TEST_DATE, 'Cook last_used_on is incorrect')
  assert(activeRow.estimated === true, 'Estimated cook should be marked estimated')
  const allCooks = await requireData(a.rpc('search_meal_components', { p_source_type: 'cook_session', p_query: '' }))
  assert(!allCooks.some((row) => row.source_id === exhaustedCook.id), 'Cook with no remaining servings must not be returned')
  log('search_meal_components: cook keyword, subtitle, available servings, last used and exhausted exclusion')

  const ingredients = await requireData(a.rpc('search_meal_components', { p_source_type: 'ingredient', p_query: '已验证燕麦' }))
  const verifiedRow = ingredients.find((row) => row.source_id === verifiedIngredient.id)
  assert(verifiedRow, 'Verified ingredient was not returned by keyword search')
  assert(verifiedRow.subtitle === '测试已验证单品', 'Ingredient subtitle is incorrect')
  assert(verifiedRow.available_servings === null, 'Ingredient available_servings should be null')
  assert(verifiedRow.last_used_on === TEST_DATE, 'Ingredient last_used_on is incorrect')
  assert(verifiedRow.estimated === false, 'Verified ingredient should not be estimated')
  log('search_meal_components: ingredient keyword, subtitle and verified state')

  const countBeforeBadSave = await mealCount(a, TEST_DATE)
  const badSave = await saveMeal(a, {
    date: TEST_DATE,
    mealType: '晚餐',
    items: [
      { sourceType: 'ingredient', ingredientId: verifiedIngredient.id, servings: 1 },
      { sourceType: 'ingredient', ingredientId: '00000000-0000-0000-0000-000000000000', servings: 1 },
    ],
  })
  assert(badSave.error, 'save_meal should reject an unavailable ingredient')
  assert(await mealCount(a, TEST_DATE) === countBeforeBadSave, 'Failed save_meal must roll back the entire meal')
  log('save_meal: invalid item rolls back entire meal', { error: badSave.error.message })

  const updateResult = await a.rpc('update_meal', {
    p_meal_id: mainMealId,
    p_eaten_on: TEST_DATE,
    p_meal_type: '晚餐',
    p_note: 'TEST 更新后的备注',
    p_items: [
      { sourceType: 'ingredient', ingredientId: estimatedIngredient.id, servings: 3 },
      { sourceType: 'cook_session', cookSessionId: activeCook.id, servings: 0.5 },
    ],
  })
  assert(!updateResult.error, 'update_meal should replace meal items', { message: updateResult.error?.message })
  const todayAfterUpdate = await getToday(a, TEST_DATE)
  const updatedMeal = todayAfterUpdate.meals.find((meal) => meal.id === mainMealId)
  assert(updatedMeal.mealType === '晚餐' && updatedMeal.note === 'TEST 更新后的备注', 'update_meal did not update the meal header')
  assert(updatedMeal.items.length === 2, 'update_meal did not replace meal items')
  assert(updatedMeal.items[0].sourceId === estimatedIngredient.id && updatedMeal.items[1].sourceId === activeCook.id, 'update_meal did not preserve replacement order')
  log('update_meal: successful item replacement')

  const snapshotBeforeBadUpdate = JSON.stringify(todayAfterUpdate)
  const badUpdate = await a.rpc('update_meal', {
    p_meal_id: mainMealId,
    p_eaten_on: TEST_DATE,
    p_meal_type: '早餐',
    p_note: 'This must not persist',
    p_items: [
      { sourceType: 'ingredient', ingredientId: estimatedIngredient.id, servings: 1 },
      { sourceType: 'ingredient', ingredientId: '00000000-0000-0000-0000-000000000000', servings: 1 },
    ],
  })
  assert(badUpdate.error, 'update_meal should reject an unavailable ingredient')
  assert(JSON.stringify(await getToday(a, TEST_DATE)) === snapshotBeforeBadUpdate, 'Failed update_meal must retain the original record')
  log('update_meal: invalid item retains original meal', { error: badUpdate.error.message })

  const bToday = await getToday(b, TEST_DATE)
  assert(bToday.meals.length === 0, 'Second user can see the first user’s meals')
  const crossUpdate = await b.rpc('update_meal', {
    p_meal_id: mainMealId,
    p_eaten_on: TEST_DATE,
    p_meal_type: '午餐',
    p_note: '',
    p_items: [{ sourceType: 'ingredient', ingredientId: verifiedIngredient.id, servings: 1 }],
  })
  assert(crossUpdate.error, 'Cross-user update should fail')
  const countBeforeCrossSave = await mealCount(b, TEST_DATE)
  const crossSave = await saveMeal(b, {
    date: TEST_DATE,
    mealType: '午餐',
    items: [{ sourceType: 'ingredient', ingredientId: verifiedIngredient.id, servings: 1 }],
  })
  assert(crossSave.error, 'Cross-user ingredient should not be selectable')
  assert(await mealCount(b, TEST_DATE) === countBeforeCrossSave, 'Cross-user failed save must not create a meal')
  log('RLS: cross-user reads and writes are isolated', {
    updateError: crossUpdate.error.message,
    saveError: crossSave.error.message,
  })

  const unauthenticated = makeClient(anon)
  const anonymousGetToday = await unauthenticated.rpc('get_today', { p_date: TEST_DATE })
  assert(anonymousGetToday.error, 'Unauthenticated RPC request should fail')
  log('RLS: unauthenticated RPC is rejected', { error: anonymousGetToday.error.message })

  const duplicateInput = {
    date: DUPLICATE_DATE,
    mealType: '早餐',
    note: 'TEST duplicate request',
    items: [{ sourceType: 'ingredient', ingredientId: verifiedIngredient.id, servings: 1 }],
  }
  const duplicateFirst = await saveMeal(a, duplicateInput)
  const duplicateSecond = await saveMeal(a, duplicateInput)
  assert(!duplicateFirst.error && !duplicateSecond.error, 'Duplicate-save test calls failed')
  assert(duplicateFirst.data !== duplicateSecond.data, 'Duplicate saves unexpectedly reused one meal')
  assert(await mealCount(a, DUPLICATE_DATE) === 2, 'Duplicate saves did not create two meals as expected')
  await requireData(a.from('meals').delete().in('id', [duplicateFirst.data, duplicateSecond.data]).select('id'))
  log('save_meal: duplicate requests currently create duplicate meals', { behavior: 'not idempotent' })

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    runId,
    testDate: TEST_DATE,
    credentials: {
      primary: { email: userA.email, password },
      isolated: { email: userB.email, password },
    },
    frontendStates: {
      emptyToday: { account: userB.email, date: TEST_DATE, target: 'null', meals: 0 },
      populatedToday: { account: userA.email, date: TEST_DATE, target: 'configured', meals: 'lunch updated to dinner plus snack' },
      components: 'verified ingredient, estimated ingredient, one cook with remaining servings, one exhausted cook excluded from search',
    },
    results,
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})

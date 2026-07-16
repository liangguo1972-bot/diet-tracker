import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CLI = process.env.SUPABASE_CLI_PATH
  ?? `${process.env.HOME}/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/dist/supabase.js`
const PROJECT_REF = 'hgefanuytaryfhsybvhf'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
const password = `Dt!${randomBytes(18).toString('base64url')}`
const createdUsers = []

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ''}`)
}

function getApiKeys() {
  const keys = JSON.parse(execFileSync('node', [
    CLI, 'projects', 'api-keys', '--project-ref', PROJECT_REF, '--reveal', '--output', 'json',
  ], { encoding: 'utf8' }))
  const anon = keys.find((key) => key.id === 'anon' || key.type === 'publishable')?.api_key
  const serviceRole = keys.find((key) => key.id === 'service_role' || key.type === 'secret')?.api_key
  assert(anon && serviceRole && !serviceRole.includes('···'), 'Supabase API keys unavailable')
  return { anon, serviceRole }
}

function client(key) {
  return createClient(PROJECT_URL, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function dataOf(operation, label) {
  const { data, error } = await operation
  assert(!error, label, { message: error?.message, details: error?.details, code: error?.code })
  return data
}

async function createUser(admin, suffix) {
  const email = `diet-fr004-${suffix}-${runId}@example.invalid`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert(!error && data.user, 'Could not create test user', { message: error?.message })
  createdUsers.push(data.user.id)
  return { id: data.user.id, email }
}

async function signIn(anon, email) {
  const signedIn = client(anon)
  const { data, error } = await signedIn.auth.signInWithPassword({ email, password })
  assert(!error && data.session, 'Could not sign in test user', { message: error?.message })
  return signedIn
}

async function cleanup(admin) {
  for (const userId of createdUsers) {
    await dataOf(admin.from('operation_requests').delete().eq('user_id', userId), 'Cleanup operations failed')
    await dataOf(admin.from('inventory_movements').delete().eq('user_id', userId), 'Cleanup movements failed')
    await dataOf(admin.from('cook_sessions').delete().eq('user_id', userId), 'Cleanup cook sessions failed')
    await dataOf(admin.from('inventory').delete().eq('user_id', userId), 'Cleanup inventory failed')
    await dataOf(admin.from('recipe_candidates').delete().eq('user_id', userId), 'Cleanup candidates failed')
    await dataOf(admin.from('recipes').delete().eq('user_id', userId), 'Cleanup recipes failed')
    await dataOf(admin.from('ingredients').delete().eq('user_id', userId), 'Cleanup ingredients failed')
    const { error } = await admin.auth.admin.deleteUser(userId)
    assert(!error, 'Cleanup auth user failed', { message: error?.message })
  }
}

async function main() {
  const { anon, serviceRole } = getApiKeys()
  const admin = client(serviceRole)
  const userA = await createUser(admin, 'a')
  const userB = await createUser(admin, 'b')
  const a = await signIn(anon, userA.email)
  const b = await signIn(anon, userB.email)

  try {
    const ingredients = await dataOf(admin.from('ingredients').insert([
      {
        user_id: userA.id,
        name: '牛肉',
        category: '肉类',
        kcal_per_100g: 200,
        protein_per_100g: 26,
        carb_per_100g: 0,
        fat_per_100g: 10,
        is_verified: true,
      },
      {
        user_id: userA.id,
        name: '洋葱',
        category: '蔬菜',
        kcal_per_100g: 40,
        protein_per_100g: 1.1,
        carb_per_100g: 9,
        fat_per_100g: 0.1,
        is_verified: true,
      },
      {
        user_id: userB.id,
        name: '牛肉',
        category: '肉类',
        kcal_per_100g: 200,
        protein_per_100g: 26,
        carb_per_100g: 0,
        fat_per_100g: 10,
        is_verified: true,
      },
    ]).select(), 'Could not create ingredient fixtures')
    const beefA = ingredients.find((row) => row.user_id === userA.id && row.name === '牛肉')
    const onionA = ingredients.find((row) => row.user_id === userA.id && row.name === '洋葱')
    const beefB = ingredients.find((row) => row.user_id === userB.id && row.name === '牛肉')
    assert(beefA && onionA && beefB, 'Ingredient fixtures missing')

    const inventory = await dataOf(admin.from('inventory').insert([
      {
        user_id: userA.id,
        ingredient_id: beefA.id,
        display_name: '牛肉库存',
        quantity: 1000,
        unit: 'g',
        unit_kind: 'weight',
        status: 'active',
        storage: '冷藏',
      },
      {
        user_id: userA.id,
        ingredient_id: onionA.id,
        display_name: '洋葱库存',
        quantity: 2,
        unit: '盒',
        unit_kind: 'container',
        status: 'active',
        storage: '冷藏',
      },
      {
        user_id: userA.id,
        ingredient_id: null,
        display_name: '未匹配香料包',
        quantity: 1,
        unit: '盒',
        unit_kind: 'container',
        status: 'active',
        storage: '常温',
      },
      {
        user_id: userB.id,
        ingredient_id: beefB.id,
        display_name: '其他用户牛肉',
        quantity: 1000,
        unit: 'g',
        unit_kind: 'weight',
        status: 'active',
        storage: '冷藏',
      },
    ]).select(), 'Could not create inventory fixtures')
    const beefLot = inventory.find((row) => row.user_id === userA.id && row.ingredient_id === beefA.id)
    const onionLot = inventory.find((row) => row.user_id === userA.id && row.ingredient_id === onionA.id)
    const unmatchedLot = inventory.find((row) => row.user_id === userA.id && row.ingredient_id === null)
    const beefLotB = inventory.find((row) => row.user_id === userB.id)
    assert(beefLot && onionLot && unmatchedLot && beefLotB, 'Inventory fixtures missing')

    const saveKey = randomUUID()
    const saveArgs = {
      p_name: '临时牛肉锅',
      p_cooked_on: '2026-07-16',
      p_total_servings: 2,
      p_note: 'FR-004 verification',
      p_idempotency_key: saveKey,
      p_items: [
        {
          inventoryId: beefLot.id,
          ingredientId: beefA.id,
          quantityUsed: 500,
          unit: 'g',
          grams: 500,
          note: '',
        },
        {
          inventoryId: onionLot.id,
          ingredientId: onionA.id,
          quantityUsed: 0.5,
          unit: '盒',
          grams: 150,
          note: '实际称重',
        },
      ],
      p_unmatched_items: [{
        inventoryId: unmatchedLot.id,
        quantityUsed: 0.25,
        unit: '盒',
        note: '不计营养',
      }],
    }

    const saved = await dataOf(a.rpc('save_cook_session_without_recipe', saveArgs), 'Could not save cook without recipe')
    const repeatedSave = await dataOf(a.rpc('save_cook_session_without_recipe', saveArgs), 'Idempotent cook retry failed')
    assert(saved.cookSessionId === repeatedSave.cookSessionId, 'Cook idempotency created another session')
    assert(saved.sourceType === 'without_recipe' && saved.recipeConfirmationStatus === 'pending', 'Cook source state is wrong', saved)
    assert(saved.nutrition.kcal === 1060 && saved.nutrition.protein === 131.65, 'Nutrition did not use submitted grams', saved.nutrition)

    const saveConflict = await a.rpc('save_cook_session_without_recipe', { ...saveArgs, p_name: '改名后重复请求' })
    assert(saveConflict.error?.message === 'IDEMPOTENCY_CONFLICT', 'Same key with different cook input should conflict', saveConflict.error)

    const operationResult = await dataOf(a.rpc('get_operation_result', {
      p_operation_type: 'save_cook_without_recipe',
      p_idempotency_key: saveKey,
    }), 'Could not query cook operation result')
    assert(operationResult.response?.cookSessionId === saved.cookSessionId, 'Cook operation result is missing')

    const savedSession = await dataOf(admin.from('cook_sessions').select('*').eq('id', saved.cookSessionId).single(), 'Could not inspect cook session')
    assert(savedSession.recipe_id === null && savedSession.source_type === 'without_recipe' && savedSession.recipe_confirmation_status === 'pending', 'Cook session source fields are wrong', savedSession)
    const cookItems = await dataOf(admin.from('cook_items').select('ingredient_id,grams').eq('cook_session_id', saved.cookSessionId), 'Could not inspect cook items')
    assert(cookItems.length === 2 && cookItems.some((row) => row.ingredient_id === beefA.id && row.grams === 500)
      && cookItems.some((row) => row.ingredient_id === onionA.id && row.grams === 150), 'Cook items do not preserve confirmed grams', cookItems)
    const unmatched = await dataOf(admin.from('cook_unmatched_items').select('*').eq('cook_session_id', saved.cookSessionId), 'Could not inspect unmatched cook items')
    assert(unmatched.length === 1 && unmatched[0].inventory_id === unmatchedLot.id, 'Unmatched inventory was not recorded separately')

    const updatedInventory = await dataOf(admin.from('inventory').select('id,quantity').in('id', [beefLot.id, onionLot.id, unmatchedLot.id]), 'Could not inspect inventory deduction')
    assert(updatedInventory.find((row) => row.id === beefLot.id)?.quantity === 500, 'Gram inventory deduction is wrong')
    assert(updatedInventory.find((row) => row.id === onionLot.id)?.quantity === 1.5, 'Same-unit container deduction is wrong')
    assert(updatedInventory.find((row) => row.id === unmatchedLot.id)?.quantity === 0.75, 'Unmatched inventory deduction is wrong')
    const movements = await dataOf(admin.from('inventory_movements').select('*').eq('cook_session_id', saved.cookSessionId), 'Could not inspect inventory movements')
    assert(movements.length === 3, 'Cook should create one movement per inventory lot')

    const componentRows = await dataOf(a.rpc('search_meal_components', { p_source_type: 'cook_session', p_query: '临时牛肉锅' }), 'Could not search new cook session')
    assert(componentRows.length === 1 && componentRows[0].source_id === saved.cookSessionId && componentRows[0].available_servings === 2, 'New cook is not available for meal recording', componentRows)
    const kitchenHome = await dataOf(a.rpc('get_kitchen_home', { p_date: '2026-07-16' }), 'Could not read kitchen home')
    const homeCook = kitchenHome.readyCookSessions.find((row) => row.id === saved.cookSessionId)
    assert(homeCook?.sourceType === 'without_recipe' && homeCook?.recipeConfirmationStatus === 'pending', 'Kitchen home cannot recover pending recipe confirmation', homeCook)
    const confirmationDraft = await dataOf(a.rpc('get_cook_recipe_confirmation', { p_cook_session_id: saved.cookSessionId }), 'Could not read recipe confirmation draft')
    assert(confirmationDraft.items.length === 2 && confirmationDraft.unmatchedItems.length === 1
      && confirmationDraft.recipeConfirmationStatus === 'pending', 'Recipe confirmation draft is incomplete', confirmationDraft)

    const sessionsBeforeFailures = await dataOf(admin.from('cook_sessions').select('id').eq('user_id', userA.id), 'Could not count sessions before rollback tests')
    const insufficient = await a.rpc('save_cook_session_without_recipe', {
      ...saveArgs,
      p_name: '库存不足锅',
      p_idempotency_key: randomUUID(),
      p_items: [{ ...saveArgs.p_items[0], quantityUsed: 999999 }],
      p_unmatched_items: [],
    })
    assert(insufficient.error?.message === 'INSUFFICIENT_STOCK', 'Insufficient stock should fail atomically', insufficient.error)
    const unitConflict = await a.rpc('save_cook_session_without_recipe', {
      ...saveArgs,
      p_name: '单位冲突锅',
      p_idempotency_key: randomUUID(),
      p_items: [{ ...saveArgs.p_items[1], unit: '袋' }],
      p_unmatched_items: [],
    })
    assert(unitConflict.error?.message === 'UNIT_CONFLICT', 'Unit conflict should fail atomically', unitConflict.error)
    const missingGrams = await a.rpc('save_cook_session_without_recipe', {
      ...saveArgs,
      p_name: '缺少克重锅',
      p_idempotency_key: randomUUID(),
      p_items: [{ ...saveArgs.p_items[0], grams: null }],
      p_unmatched_items: [],
    })
    assert(['GRAMS_REQUIRED', 'COOK_ITEMS_INVALID'].includes(missingGrams.error?.message), 'Missing grams should be rejected', missingGrams.error)
    const crossInventory = await a.rpc('save_cook_session_without_recipe', {
      ...saveArgs,
      p_name: '跨用户库存锅',
      p_idempotency_key: randomUUID(),
      p_items: [{
        inventoryId: beefLotB.id,
        ingredientId: beefB.id,
        quantityUsed: 100,
        unit: 'g',
        grams: 100,
      }],
      p_unmatched_items: [],
    })
    assert(crossInventory.error?.message === 'INVALID_REFERENCE', 'Cross-user inventory should be rejected', crossInventory.error)
    const sessionsAfterFailures = await dataOf(admin.from('cook_sessions').select('id').eq('user_id', userA.id), 'Could not count sessions after rollback tests')
    assert(sessionsAfterFailures.length === sessionsBeforeFailures.length, 'Failed cook save left a partial session')

    const recipeKey = randomUUID()
    const recipeResult = await dataOf(a.rpc('create_recipe_from_cook_session', {
      p_cook_session_id: saved.cookSessionId,
      p_name: '临时牛肉锅',
      p_idempotency_key: recipeKey,
    }), 'Could not create recipe from cook session')
    const repeatedRecipe = await dataOf(a.rpc('create_recipe_from_cook_session', {
      p_cook_session_id: saved.cookSessionId,
      p_name: '临时牛肉锅',
      p_idempotency_key: recipeKey,
    }), 'Idempotent recipe confirmation failed')
    assert(recipeResult.recipeId === repeatedRecipe.recipeId && recipeResult.candidateId === repeatedRecipe.candidateId, 'Recipe confirmation idempotency created duplicates')

    const confirmedDraft = await dataOf(a.rpc('get_cook_recipe_confirmation', { p_cook_session_id: saved.cookSessionId }), 'Could not read confirmed recipe state')
    assert(confirmedDraft.recipeConfirmationStatus === 'confirmed' && confirmedDraft.recipeId === recipeResult.recipeId, 'Cook session was not attached to generated recipe', confirmedDraft)
    const recipeItems = await dataOf(admin.from('recipe_items').select('ingredient_id,grams').eq('recipe_id', recipeResult.recipeId), 'Could not inspect generated recipe items')
    assert(recipeItems.length === 2 && !recipeItems.some((row) => row.ingredient_id === null), 'Generated recipe contains wrong items', recipeItems)
    assert(!recipeItems.some((row) => row.ingredient_id !== beefA.id && row.ingredient_id !== onionA.id), 'Unmatched inventory entered recipe items', recipeItems)
    const candidateRows = await dataOf(a.rpc('list_recipe_candidates'), 'Could not read generated candidate')
    assert(candidateRows.some((row) => row.recipeId === recipeResult.recipeId && row.status === 'candidate'), 'Generated recipe is not in candidate pool', candidateRows)
    const recipeOperation = await dataOf(a.rpc('get_operation_result', {
      p_operation_type: 'create_recipe_from_cook_session',
      p_idempotency_key: recipeKey,
    }), 'Could not query recipe confirmation result')
    assert(recipeOperation.response?.recipeId === recipeResult.recipeId, 'Recipe operation result is missing')

    const plannedCook = await dataOf(a.rpc('save_cook_session', {
      p_recipe_id: recipeResult.recipeId,
      p_name: '按菜谱再做一锅',
      p_cooked_on: '2026-07-16',
      p_total_servings: 2,
      p_note: '',
      p_idempotency_key: randomUUID(),
      p_items: [
        {
          inventoryId: beefLot.id,
          ingredientId: beefA.id,
          quantityUsed: 50,
          unit: 'g',
          note: '',
        },
        {
          inventoryId: onionLot.id,
          ingredientId: onionA.id,
          quantityUsed: 0.1,
          unit: '盒',
          note: '',
        },
      ],
      p_unmatched_items: [],
    }), 'Existing recipe-based cook RPC regressed')
    const plannedSession = await dataOf(admin.from('cook_sessions').select('source_type,recipe_confirmation_status,recipe_id').eq('id', plannedCook.cookSessionId).single(), 'Could not inspect recipe-based cook')
    assert(plannedSession.source_type === 'recipe' && plannedSession.recipe_confirmation_status === 'not_required'
      && plannedSession.recipe_id === recipeResult.recipeId, 'Existing recipe-based cook state changed', plannedSession)

    const duplicateSession = await dataOf(a.rpc('save_cook_session_without_recipe', {
      p_name: '另一锅',
      p_cooked_on: '2026-07-16',
      p_total_servings: 1,
      p_note: '',
      p_idempotency_key: randomUUID(),
      p_items: [{
        inventoryId: beefLot.id,
        ingredientId: beefA.id,
        quantityUsed: 100,
        unit: 'g',
        grams: 100,
      }],
      p_unmatched_items: [],
    }), 'Could not create duplicate-name test cook')
    const duplicateName = await a.rpc('create_recipe_from_cook_session', {
      p_cook_session_id: duplicateSession.cookSessionId,
      p_name: '临时牛肉锅',
      p_idempotency_key: randomUUID(),
    })
    assert(duplicateName.error?.message === 'DUPLICATE_RECIPE_NAME', 'Duplicate recipe name should not overwrite', duplicateName.error)
    const duplicateDraft = await dataOf(a.rpc('get_cook_recipe_confirmation', { p_cook_session_id: duplicateSession.cookSessionId }), 'Could not read duplicate-name recovery state')
    assert(duplicateDraft.recipeConfirmationStatus === 'pending' && duplicateDraft.recipeId === null, 'Failed recipe confirmation changed the cook session')

    const secondConfirmation = await a.rpc('create_recipe_from_cook_session', {
      p_cook_session_id: saved.cookSessionId,
      p_name: '另一个名称',
      p_idempotency_key: randomUUID(),
    })
    assert(secondConfirmation.error?.message === 'CONFLICT', 'A confirmed cook should not generate another recipe', secondConfirmation.error)
    const crossDraft = await b.rpc('get_cook_recipe_confirmation', { p_cook_session_id: saved.cookSessionId })
    assert(crossDraft.error?.message === 'INVALID_REFERENCE', 'Cross-user confirmation draft leaked data', crossDraft.error)
    const crossConfirm = await b.rpc('create_recipe_from_cook_session', {
      p_cook_session_id: duplicateSession.cookSessionId,
      p_name: '越权菜谱',
      p_idempotency_key: randomUUID(),
    })
    assert(crossConfirm.error?.message === 'INVALID_REFERENCE', 'Cross-user recipe confirmation should fail', crossConfirm.error)
    const isolatedComponents = await dataOf(b.rpc('search_meal_components', { p_source_type: 'cook_session', p_query: '' }), 'Could not read isolated meal components')
    assert(!isolatedComponents.some((row) => row.source_id === saved.cookSessionId), 'Cook session leaked through meal selector')

    const directSessionInsert = await a.from('cook_sessions').insert({
      user_id: userA.id,
      cooked_on: '2026-07-16',
      recipe_id: recipeResult.recipeId,
      name: '绕过 RPC',
      total_servings: 1,
      source_type: 'recipe',
      recipe_confirmation_status: 'not_required',
    })
    assert(directSessionInsert.error?.code === '42501', 'Authenticated user can insert cook sessions directly', directSessionInsert.error)
    const directSessionUpdate = await a.from('cook_sessions').update({ name: '绕过更新' }).eq('id', saved.cookSessionId)
    assert(directSessionUpdate.error?.code === '42501', 'Authenticated user can update cook sessions directly', directSessionUpdate.error)
    const directCookItem = await a.from('cook_items').insert({
      cook_session_id: saved.cookSessionId,
      ingredient_id: beefA.id,
      grams: 1,
    })
    assert(directCookItem.error?.code === '42501', 'Authenticated user can insert cook items directly', directCookItem.error)

    console.log(JSON.stringify({
      passed: true,
      checks: [
        'cook without recipe saves a real meal-selectable cook session',
        'inventory quantities and nutrition grams stay separate',
        'matched and unmatched inventory deductions are atomic',
        'explicit cook grams drive nutrition and generated recipe items',
        'save idempotency and network result query',
        'inventory shortage, unit conflict, missing grams, and cross-user rollback',
        'pending recipe confirmation recovery from kitchen home and detail RPC',
        'recipe and candidate creation from the saved cook session',
        'existing recipe-based save_cook_session remains compatible',
        'recipe confirmation idempotency and duplicate-name protection',
        'unmatched inventory excluded from nutrition and recipe items',
        'cross-user RLS and direct cook table writes denied',
      ],
    }, null, 2))
  } finally {
    await cleanup(admin)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

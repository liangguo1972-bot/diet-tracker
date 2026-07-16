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
  const email = `diet-fr001-ai-${suffix}-${runId}@example.invalid`
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

async function createImport(admin, userId, suffix) {
  return dataOf(admin.from('receipt_imports').insert({
    user_id: userId,
    storage_path: `${userId}/${randomUUID()}/source.jpg`,
    file_name: `${suffix}.jpg`,
    content_type: 'image/jpeg',
    file_size_bytes: 100,
    status: 'uploaded',
  }).select().single(), 'Could not create receipt import')
}

async function applySuggestion(admin, receiptId, rawName, suggestion) {
  return dataOf(admin.rpc('apply_receipt_recognition', {
    p_receipt_import_id: receiptId,
    p_raw_text: rawName,
    p_provider: 'ai_contract_test',
    p_items: [{
      name: rawName,
      quantity: null,
      unit: null,
      price: 3.99,
      suggestedIngredientId: suggestion.id,
      suggestedName: suggestion.name,
      suggestionConfidence: 0.85,
      suggestionReason: suggestion.reason,
      suggestionSource: 'openai',
    }],
  }), 'Could not apply recognition suggestion')
}

async function updateAndConfirm(userClient, draft, ingredientId) {
  await dataOf(userClient.rpc('update_receipt_items', {
    p_receipt_import_id: draft.receiptImportId,
    p_items: draft.items.map((item) => ({
      receiptItemId: item.receiptItemId,
      ingredientId,
      action: 'add_to_inventory',
      confirmedName: item.confirmedName,
      confirmedQuantity: item.confirmedQuantity,
      confirmedUnit: item.confirmedUnit,
      storage: '常温',
    })),
  }), 'Could not update receipt draft')
  const key = randomUUID()
  const confirmed = await dataOf(userClient.rpc('confirm_receipt_import', {
    p_receipt_import_id: draft.receiptImportId,
    p_idempotency_key: key,
  }), 'Could not confirm receipt')
  const repeated = await dataOf(userClient.rpc('confirm_receipt_import', {
    p_receipt_import_id: draft.receiptImportId,
    p_idempotency_key: key,
  }), 'Could not repeat receipt confirmation')
  assert(JSON.stringify(confirmed) === JSON.stringify(repeated), 'Confirmation idempotency changed result')
}

async function cleanup(admin) {
  for (const userId of createdUsers) {
    const imports = await dataOf(admin.from('receipt_imports').select('id').eq('user_id', userId), 'Cleanup imports read failed')
    const importIds = imports.map((row) => row.id)
    if (importIds.length) {
      await dataOf(admin.from('receipt_items').update({ inventory_id: null }).in('receipt_import_id', importIds), 'Cleanup receipt links failed')
    }
    await dataOf(admin.from('operation_requests').delete().eq('user_id', userId), 'Cleanup operations failed')
    await dataOf(admin.from('inventory_movements').delete().eq('user_id', userId), 'Cleanup movements failed')
    await dataOf(admin.from('inventory').delete().eq('user_id', userId), 'Cleanup inventory failed')
    await dataOf(admin.from('ingredient_aliases').delete().eq('user_id', userId), 'Cleanup aliases failed')
    await dataOf(admin.from('receipt_imports').delete().eq('user_id', userId), 'Cleanup receipts failed')
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
      { user_id: userA.id, name: '香蕉', category: '水果', is_verified: true },
      { user_id: userA.id, name: '牛奶', category: '乳制品', is_verified: true },
      { user_id: userA.id, name: '酸奶', category: '乳制品', is_verified: true },
      { user_id: userB.id, name: '香蕉', category: '水果', is_verified: true },
    ]).select(), 'Could not create ingredients')
    const bananaA = ingredients.find((item) => item.user_id === userA.id && item.name === '香蕉')
    const milkA = ingredients.find((item) => item.user_id === userA.id && item.name === '牛奶')
    const bananaB = ingredients.find((item) => item.user_id === userB.id && item.name === '香蕉')
    assert(bananaA && milkA && bananaB, 'Ingredient fixtures missing')

    const quotaReceipt = await createImport(admin, userA.id, 'quota')
    const firstClaim = await dataOf(a.rpc('claim_receipt_ai_match_call', {
      p_receipt_import_id: quotaReceipt.id,
      p_input_hash: 'same-input',
      p_item_count: 1,
      p_provider: 'openai',
      p_model: 'gpt-5-mini',
    }), 'Could not claim AI suggestion call')
    assert(firstClaim.mode === 'call' && firstClaim.matchCallId, 'First claim did not reserve a call')
    const cachedResponse = [{
      position: 0,
      normalizedName: '香蕉',
      suggestedCandidateKey: 'c0',
      suggestedIngredientName: '香蕉',
      confidence: 'high',
      reason: '商品名表示香蕉',
      specificationSensitive: false,
    }]
    await dataOf(admin.rpc('complete_receipt_ai_match_call', {
      p_match_call_id: firstClaim.matchCallId,
      p_status: 'succeeded',
      p_response: cachedResponse,
      p_error_code: null,
      p_input_tokens: 100,
      p_output_tokens: 40,
    }), 'Could not complete AI suggestion call')
    const cachedClaim = await dataOf(a.rpc('claim_receipt_ai_match_call', {
      p_receipt_import_id: quotaReceipt.id,
      p_input_hash: 'same-input',
      p_item_count: 1,
      p_provider: 'openai',
      p_model: 'gpt-5-mini',
    }), 'Could not reuse cached AI result')
    assert(cachedClaim.mode === 'cached' && cachedClaim.response?.[0]?.normalizedName === '香蕉', 'AI result cache was not reused')
    const directCalls = await a.from('receipt_ai_match_calls').select('id')
    assert(directCalls.error, 'Authenticated user should not read AI usage table directly')

    const ignoredReceipt = await createImport(admin, userA.id, 'ignored-suggestion')
    await applySuggestion(admin, ignoredReceipt.id, 'CHIQ BANANAS', {
      id: bananaA.id,
      name: bananaA.name,
      reason: '英文商品名建议香蕉，等待确认',
    })
    const ignoredDraft = await dataOf(a.rpc('get_receipt_import', { p_receipt_import_id: ignoredReceipt.id }), 'Could not read suggested draft')
    assert(ignoredDraft.items[0].ingredientId === null, 'AI suggestion became confirmed ingredient')
    assert(ignoredDraft.items[0].suggestedIngredientId === bananaA.id, 'Banana suggestion was not returned separately')
    assert(ignoredDraft.items[0].matchStatus === 'possible_match', 'AI suggestion should require confirmation')
    await updateAndConfirm(a, ignoredDraft, null)
    const unsafeAlias = await dataOf(admin.from('ingredient_aliases').select('id').eq('user_id', userA.id).eq('normalized_alias', 'chiqbananas'), 'Could not inspect aliases')
    assert(unsafeAlias.length === 0, 'Unaccepted AI suggestion created an alias')

    const acceptedReceipt = await createImport(admin, userA.id, 'accepted-suggestion')
    await applySuggestion(admin, acceptedReceipt.id, 'CHIQ BANANAS', {
      id: bananaA.id,
      name: bananaA.name,
      reason: '英文商品名建议香蕉，等待确认',
    })
    const acceptedDraft = await dataOf(a.rpc('get_receipt_import', { p_receipt_import_id: acceptedReceipt.id }), 'Could not read accepted draft')
    await updateAndConfirm(a, acceptedDraft, bananaA.id)
    const alias = await dataOf(admin.from('ingredient_aliases').select('ingredient_id').eq('user_id', userA.id).eq('normalized_alias', 'chiqbananas').single(), 'Accepted alias was not created')
    assert(alias.ingredient_id === bananaA.id, 'Accepted alias points to wrong ingredient')

    const repeatedReceipt = await createImport(admin, userA.id, 'alias-reuse')
    await dataOf(admin.rpc('apply_receipt_recognition', {
      p_receipt_import_id: repeatedReceipt.id,
      p_raw_text: 'CHIQ BANANAS',
      p_provider: 'alias_contract_test',
      p_items: [{ name: 'CHIQ BANANAS', quantity: null, unit: null, price: 3.99 }],
    }), 'Could not test alias reuse')
    const repeatedDraft = await dataOf(a.rpc('get_receipt_import', { p_receipt_import_id: repeatedReceipt.id }), 'Could not read alias reuse draft')
    assert(repeatedDraft.items[0].matchStatus === 'matched' && repeatedDraft.items[0].ingredientId === bananaA.id, 'Confirmed exact alias was not reused')

    const sensitiveReceipt = await createImport(admin, userA.id, 'sensitive')
    await applySuggestion(admin, sensitiveReceipt.id, 'LOW FAT MILK', {
      id: milkA.id,
      name: milkA.name,
      reason: '规格敏感，需确认。低脂规格与泛化牛奶不完全相同',
    })
    const sensitiveDraft = await dataOf(a.rpc('get_receipt_import', { p_receipt_import_id: sensitiveReceipt.id }), 'Could not read sensitive draft')
    assert(sensitiveDraft.items[0].ingredientId === null && sensitiveDraft.items[0].matchStatus === 'possible_match', 'Sensitive milk was promoted to a reliable match')

    const crossReceipt = await createImport(admin, userA.id, 'cross-user')
    const crossApply = await admin.rpc('apply_receipt_recognition', {
      p_receipt_import_id: crossReceipt.id,
      p_raw_text: 'CHIQ BANANAS',
      p_provider: 'cross_user_test',
      p_items: [{
        name: 'CHIQ BANANAS',
        suggestedIngredientId: bananaB.id,
        suggestedName: bananaB.name,
        suggestionConfidence: 0.85,
        suggestionReason: 'invalid cross-user candidate',
        suggestionSource: 'openai',
      }],
    })
    assert(crossApply.error?.message === 'RECEIPT_RECOGNITION_INVALID', 'Cross-user suggestion was not rejected', crossApply.error)
    const crossRead = await b.rpc('get_receipt_import', { p_receipt_import_id: sensitiveReceipt.id })
    assert(crossRead.error?.message === 'INVALID_REFERENCE', 'Cross-user draft read leaked data', crossRead.error)

    console.log(JSON.stringify({
      passed: true,
      checks: [
        'AI call quota claim and cache reuse',
        'AI usage table direct access denied',
        'banana suggestion remains separate from confirmed ingredient',
        'unaccepted suggestion creates no alias',
        'accepted suggestion creates exact alias',
        'exact alias is automatically reused',
        'specification-sensitive milk remains possible_match',
        'confirmation idempotency unchanged',
        'cross-user suggestion and draft isolation',
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

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
  const email = `diet-fr001-review-${suffix}-${runId}@example.invalid`
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
    if (importIds.length) {
      await dataOf(admin.from('receipt_items').delete().in('receipt_import_id', importIds), 'Cleanup receipt items failed')
    }
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
      { user_id: userA.id, name: 'MILK', category: '乳制品', is_verified: true },
    ]).select(), 'Could not create ingredients')
    const banana = ingredients.find((item) => item.name === '香蕉')
    assert(banana, 'Banana fixture missing')

    const ownSearch = await dataOf(a.rpc('search_receipt_ingredients', { p_query: '香蕉' }), 'Ingredient search failed')
    const isolatedSearch = await dataOf(b.rpc('search_receipt_ingredients', { p_query: '' }), 'Isolated search failed')
    assert(ownSearch.length === 1 && ownSearch[0].ingredient_id === banana.id, 'Ingredient search returned wrong data')
    assert(isolatedSearch.length === 0, 'Ingredient search leaked another user data')

    const receipt = await createImport(admin, userA.id, 'review')
    await dataOf(admin.rpc('apply_receipt_recognition', {
      p_receipt_import_id: receipt.id,
      p_raw_text: 'CHIQ BANANAS 6.49 LOW FAT MILK 5.99 APPLES 2.24 LB 7.99',
      p_provider: 'contract_test',
      p_items: [
        { name: 'CHIQ BANANAS', quantity: 6.49, unit: null, price: 6.49 },
        { name: 'LOW FAT MILK', quantity: 5.99, unit: null, price: 5.99 },
        { name: 'APPLES', quantity: 2.24, unit: 'lb', price: 7.99 },
      ],
    }), 'Recognition mapping failed')

    let draft = await dataOf(a.rpc('get_receipt_import', { p_receipt_import_id: receipt.id }), 'Draft read failed')
    assert(draft.items[0].rawQuantity === 6.49 && draft.items[0].confirmedQuantity === 1 && draft.items[0].confirmedUnit === '件', 'Price-like quantity was not isolated')
    assert(draft.items[1].matchStatus === 'possible_match', 'Nutrition-sensitive broader match should require confirmation')
    assert(draft.items[2].confirmedQuantity === 2.24 && draft.items[2].confirmedUnit === 'lb', 'Reliable quantity and unit were not preserved')

    const missingStorage = await a.rpc('confirm_receipt_import', {
      p_receipt_import_id: receipt.id,
      p_idempotency_key: randomUUID(),
    })
    assert(missingStorage.error?.message === 'RECEIPT_ITEM_STORAGE_INVALID', 'Confirm should return stable storage error', missingStorage.error)
    assert(missingStorage.error?.details?.includes('receiptItemId') && missingStorage.error?.details?.includes('storage'), 'Storage error should identify row and field', missingStorage.error)

    const invalidStorage = await a.rpc('update_receipt_items', {
      p_receipt_import_id: receipt.id,
      p_items: draft.items.map((item) => ({
        receiptItemId: item.receiptItemId,
        ingredientId: item.receiptItemId === draft.items[0].receiptItemId ? banana.id : null,
        action: 'add_to_inventory',
        confirmedName: item.confirmedName,
        confirmedQuantity: item.confirmedQuantity,
        confirmedUnit: item.confirmedUnit,
        storage: '车库',
      })),
    })
    assert(invalidStorage.error?.message === 'RECEIPT_ITEM_STORAGE_INVALID', 'Update should reject invalid storage', invalidStorage.error)

    draft = await dataOf(a.rpc('update_receipt_items', {
      p_receipt_import_id: receipt.id,
      p_items: draft.items.map((item, index) => ({
        receiptItemId: item.receiptItemId,
        ingredientId: index === 0 ? banana.id : null,
        action: 'add_to_inventory',
        confirmedName: item.confirmedName,
        confirmedQuantity: index < 2 ? item.rawPrice : item.confirmedQuantity,
        confirmedUnit: index < 2 ? null : item.confirmedUnit,
        storage: index === 2 ? '常温' : '冷藏',
      })),
    }), 'Valid draft update failed')
    assert(draft.items[0].confirmedQuantity === 1 && draft.items[0].confirmedUnit === '件', 'Omitted unit should force backend fallback')
    assert(draft.items[1].ingredientId === null, 'Sensitive suggestion should remain unmatched without explicit choice')

    const idempotencyKey = randomUUID()
    const confirmed = await dataOf(a.rpc('confirm_receipt_import', {
      p_receipt_import_id: receipt.id,
      p_idempotency_key: idempotencyKey,
    }), 'Receipt confirmation failed')
    const repeated = await dataOf(a.rpc('confirm_receipt_import', {
      p_receipt_import_id: receipt.id,
      p_idempotency_key: idempotencyKey,
    }), 'Idempotent retry failed')
    assert(confirmed.inventoryCount === 3 && repeated.inventoryCount === 3, 'Idempotent result changed')
    const inventory = await dataOf(admin.from('inventory').select('id,quantity,unit,storage').eq('user_id', userA.id), 'Inventory read failed')
    assert(inventory.length === 3, 'Receipt confirmation created duplicate inventory')
    const alias = await dataOf(admin.from('ingredient_aliases').select('ingredient_id').eq('user_id', userA.id).eq('normalized_alias', 'chiqbananas').single(), 'Alias was not created')
    assert(alias.ingredient_id === banana.id, 'Alias points to wrong ingredient')

    const repeatReceipt = await createImport(admin, userA.id, 'alias')
    await dataOf(admin.rpc('apply_receipt_recognition', {
      p_receipt_import_id: repeatReceipt.id,
      p_raw_text: 'CHIQ BANANAS',
      p_provider: 'contract_test',
      p_items: [{ name: 'CHIQ BANANAS', quantity: null, unit: null, price: 3.99 }],
    }), 'Alias recognition failed')
    const repeatDraft = await dataOf(a.rpc('get_receipt_import', { p_receipt_import_id: repeatReceipt.id }), 'Alias draft read failed')
    assert(repeatDraft.items[0].matchStatus === 'matched' && repeatDraft.items[0].ingredientId === banana.id, 'Confirmed alias was not reused')

    const crossUser = await b.rpc('get_receipt_import', { p_receipt_import_id: repeatReceipt.id })
    assert(crossUser.error?.message === 'INVALID_REFERENCE', 'Cross-user receipt read should be isolated', crossUser.error)

    const invalidInventory = await admin.from('inventory').insert({
      user_id: userA.id,
      quantity: 1,
      unit: '件',
      unit_kind: 'count',
      status: 'active',
      display_name: 'invalid storage test',
      storage: '车库',
    })
    assert(invalidInventory.error?.code === '23514', 'Inventory storage constraint was not enforced', invalidInventory.error)

    console.log(JSON.stringify({
      passed: true,
      checks: [
        'safe quantity and unit defaults',
        'reliable quantity preservation',
        'nutrition-sensitive possible match',
        'stable field errors',
        'manual ingredient search and RLS',
        'alias creation and reuse',
        'atomic confirmation and idempotency',
        'cross-user isolation',
        'three-value inventory storage constraint',
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

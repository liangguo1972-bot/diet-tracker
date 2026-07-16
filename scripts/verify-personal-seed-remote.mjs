import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'hgefanuytaryfhsybvhf'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const CLI = process.env.SUPABASE_CLI_PATH
  ?? `${process.env.HOME}/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/dist/supabase.js`
const email = valueAfter('--email')
const passwordEnv = valueAfter('--password-env') || 'DIET_TRACKER_IMPORT_PASSWORD'
const password = process.env[passwordEnv]
let temporaryReceiptId = null

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ''}`)
}

function sourceRecipeNames() {
  return new Set(readFileSync(new URL('../data/菜谱库.csv', import.meta.url), 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .slice(2)
    .filter(Boolean)
    .map((line) => line.split(',')[0]))
}

function getApiKeys() {
  const keys = JSON.parse(execFileSync('node', [
    CLI, 'projects', 'api-keys', '--project-ref', PROJECT_REF, '--reveal', '--output', 'json',
  ], { encoding: 'utf8' }))
  const publishable = keys.find((key) => key.id === 'anon' || key.type === 'publishable')?.api_key
  const serviceRole = keys.find((key) => key.id === 'service_role')?.api_key
  assert(publishable && serviceRole && !serviceRole.includes('···'), 'Supabase API keys unavailable')
  return { publishable, serviceRole }
}

function client(key) {
  return createClient(PROJECT_URL, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function dataOf(operation, label) {
  const { data, error } = await operation
  assert(!error, label, { message: error?.message, details: error?.details, code: error?.code })
  return data
}

async function main() {
  assert(email && password, 'Verification account credentials missing')
  const { publishable, serviceRole } = getApiKeys()
  const user = client(publishable)
  const admin = client(serviceRole)
  const { data: session, error: signInError } = await user.auth.signInWithPassword({ email, password })
  assert(!signInError && session.user, 'Could not sign in to verification account', { message: signInError?.message })
  const userId = session.user.id

  try {
    const ingredients = await dataOf(admin.from('ingredients')
      .select('id,name,canonical_name,seed_source')
      .eq('user_id', userId)
      .eq('seed_source', 'personal_base_v1'), 'Could not read seeded ingredients')
    assert(ingredients.length === 52, 'Seed ingredient count mismatch', { count: ingredients.length })
    assert(new Set(ingredients.map((row) => row.canonical_name.trim().toLowerCase())).size === 52, 'Seed canonical names are not unique')

    const recipes = await dataOf(admin.from('recipes')
      .select('id,name,servings,seed_key,seed_source')
      .eq('user_id', userId)
      .eq('seed_source', 'personal_base_v1'), 'Could not read seeded recipes')
    const expectedRecipeNames = sourceRecipeNames()
    assert(recipes.length === 35, 'Seed recipe count mismatch', { count: recipes.length })
    assert(recipes.every((row) => row.seed_key && Number(row.servings) > 0), 'Seed recipe key or servings missing')
    assert(expectedRecipeNames.size === 35
      && recipes.every((row) => expectedRecipeNames.has(row.name)),
    'Seed recipe names are incomplete')

    const recipeIds = recipes.map((row) => row.id)
    const recipeItems = await dataOf(admin.from('recipe_items')
      .select('recipe_id,ingredient_id,grams')
      .in('recipe_id', recipeIds), 'Could not read seed recipe items')
    assert(recipeItems.length > 0 && recipeItems.every((row) => Number(row.grams) > 0), 'Seed recipe items are incomplete')

    const candidates = await dataOf(admin.from('recipe_candidates')
      .select('recipe_id,status')
      .eq('user_id', userId)
      .in('recipe_id', recipeIds), 'Could not read seed candidates')
    assert(candidates.length === 33 && candidates.every((row) => row.status === 'candidate'), 'Seed candidate count mismatch', { count: candidates.length })

    const candidateApi = await dataOf(user.rpc('list_recipe_candidates'), 'Candidate API failed')
    const seededCandidateIds = new Set(candidates.map((row) => row.recipe_id))
    assert(candidateApi.filter((row) => seededCandidateIds.has(row.recipeId)).length === 33, 'Candidate API does not expose all seeded candidates')

    const rules = await dataOf(admin.from('ingredient_match_rules')
      .select('ingredient_id,alias,match_risk')
      .eq('user_id', userId)
      .eq('source', 'personal_seed'), 'Could not read seed match rules')
    assert(rules.length === 85, 'Seed match rule count mismatch', { count: rules.length })
    assert(rules.filter((row) => row.match_risk === 'safe').length === 40, 'Safe alias count mismatch')
    assert(rules.filter((row) => row.match_risk !== 'safe').length === 45, 'Review-only rule count mismatch')
    assert(!rules.some((row) => /^\d+$/.test(row.alias)), 'Numeric receipt specification fragment was imported as an alias')
    assert(rules.some((row) => row.alias === 'RAW SHRIMP 16/20')
      && rules.some((row) => row.alias === 'GRND BEEF 85/15')
      && rules.some((row) => row.alias === '90/10'),
    'Receipt specifications were not preserved in complete aliases')

    const forbiddenRuleRead = await user.from('ingredient_match_rules').select('id').limit(1)
    assert(forbiddenRuleRead.error, 'Authenticated user should not directly read internal match rules')

    const convertedNames = [
      '365WFM OG LRG GRD A EGG',
      'YELLOW PEACH',
      'OG HASS AVOCADO LARGE',
      'ENGLISH CUCUMBER',
      'OG WHITE ONION',
      'DRSCL OG BLUEBERRY 180Z',
    ]
    const convertedInventory = await dataOf(admin.from('inventory')
      .select('id,ingredient_id,receipt_item_id,receipt_raw_name')
      .eq('user_id', userId)
      .in('receipt_raw_name', convertedNames), 'Could not read converted inventory')
    assert(convertedInventory.length === 6 && convertedInventory.every((row) => row.ingredient_id), 'Safe inventory conversion is incomplete')

    const convertedReceiptIds = convertedInventory.map((row) => row.receipt_item_id).filter(Boolean)
    const convertedReceiptItems = await dataOf(admin.from('receipt_items')
      .select('id,ingredient_id,match_status')
      .in('id', convertedReceiptIds), 'Could not read converted receipt items')
    assert(convertedReceiptItems.length === 6
      && convertedReceiptItems.every((row) => row.ingredient_id && row.match_status === 'matched'),
    'Converted receipt items are inconsistent')

    const unmatched = await dataOf(admin.from('inventory')
      .select('receipt_raw_name')
      .eq('user_id', userId)
      .is('ingredient_id', null), 'Could not read remaining unmatched inventory')
    assert(unmatched.length === 7, 'Unexpected remaining unmatched inventory count', { count: unmatched.length })
    assert(unmatched.some((row) => row.receipt_raw_name === 'FAGE PLN GREEK YOGRT'), 'Specification-sensitive yogurt should remain unmatched')
    assert(unmatched.some((row) => row.receipt_raw_name === 'MHCRM OG 2PCT MILK'), 'Specification-sensitive milk should remain unmatched')

    const testReceipt = await dataOf(admin.from('receipt_imports').insert({
      user_id: userId,
      storage_path: `${userId}/${randomUUID()}/seed-verification`,
      file_name: 'seed-verification.png',
      content_type: 'image/png',
      file_size_bytes: 1,
      status: 'uploaded',
    }).select('id').single(), 'Could not create temporary receipt')
    temporaryReceiptId = testReceipt.id

    await dataOf(admin.rpc('apply_receipt_recognition', {
      p_receipt_import_id: temporaryReceiptId,
      p_raw_text: 'seed verification',
      p_provider: 'seed_verification',
      p_items: [
        { name: 'YELLOW PEACH', line: 'YELLOW PEACH', quantity: 1, unit: '个', price: 1.99 },
        { name: 'FAGE GREEK YOGURT', line: 'FAGE GREEK YOGURT', quantity: 1, unit: '盒', price: 5.99 },
      ],
    }), 'Seed dictionary trigger verification failed')

    const draft = await dataOf(user.rpc('get_receipt_import', {
      p_receipt_import_id: temporaryReceiptId,
    }), 'Could not read temporary receipt')
    assert(draft.items[0].matchStatus === 'matched' && draft.items[0].ingredientId, 'Safe rule did not auto-match')
    assert(draft.items[1].matchStatus === 'possible_match'
      && !draft.items[1].ingredientId
      && draft.items[1].suggestedIngredientId
      && draft.items[1].suggestionSource === 'seed_dictionary',
    'Specification-sensitive rule did not remain review-only')

    console.log(JSON.stringify({
      passed: true,
      checks: [
        '52 seeded ingredients with unique canonical names',
        '35 recipes with positive servings and recipe items',
        '33 candidate recipes visible through the production RPC',
        '40 safe aliases and 45 review-only receipt rules',
        'internal dictionary denied to authenticated direct reads',
        '6 safe inventory placeholders and receipt rows converted consistently',
        '7 uncertain inventory placeholders preserved',
        'safe receipt rule auto-matches and sensitive rule remains possible_match',
      ],
    }, null, 2))
  } finally {
    if (temporaryReceiptId) {
      await admin.from('receipt_items').delete().eq('receipt_import_id', temporaryReceiptId)
      await admin.from('receipt_imports').delete().eq('id', temporaryReceiptId)
    }
    await user.auth.signOut()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

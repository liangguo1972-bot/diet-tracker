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
  const email = `diet-fr003-${suffix}-${runId}@example.invalid`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert(!error && data.user, 'Could not create test user', { message: error?.message })
  createdUsers.push(data.user.id)
  return { id: data.user.id, email }
}

async function signIn(anon, email) {
  const signedIn = client(anon)
  const { data, error } = await signedIn.auth.signInWithPassword({ email, password })
  assert(!error && data.session, 'Could not sign in test user', { message: error?.message })
  return { client: signedIn, accessToken: data.session.access_token }
}

async function cleanup(admin) {
  for (const userId of createdUsers) {
    await dataOf(admin.from('recipe_parse_calls').delete().eq('user_id', userId), 'Cleanup parse calls failed')
    await dataOf(admin.from('operation_requests').delete().eq('user_id', userId), 'Cleanup operations failed')
    await dataOf(admin.from('recipe_candidates').delete().eq('user_id', userId), 'Cleanup candidates failed')
    await dataOf(admin.from('recipes').delete().eq('user_id', userId), 'Cleanup recipes failed')
    await dataOf(admin.from('ingredient_aliases').delete().eq('user_id', userId), 'Cleanup aliases failed')
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
      { user_id: userA.id, name: '牛肉', category: '肉类', kcal_per_100g: 250, protein_per_100g: 26, is_verified: true },
      { user_id: userA.id, name: '洋葱', category: '蔬菜', kcal_per_100g: 40, protein_per_100g: 1.1, is_verified: true },
      { user_id: userA.id, name: '番茄', category: '蔬菜', kcal_per_100g: 18, protein_per_100g: 0.9, is_verified: true },
      { user_id: userB.id, name: '牛肉', category: '肉类', kcal_per_100g: 240, protein_per_100g: 25, is_verified: true },
    ]).select(), 'Could not create ingredients')
    const beefA = ingredients.find((item) => item.user_id === userA.id && item.name === '牛肉')
    const onionA = ingredients.find((item) => item.user_id === userA.id && item.name === '洋葱')
    const beefB = ingredients.find((item) => item.user_id === userB.id && item.name === '牛肉')
    assert(beefA && onionA && beefB, 'Ingredient fixtures missing')

    await dataOf(admin.from('ingredient_aliases').insert({
      user_id: userA.id,
      ingredient_id: beefA.id,
      alias: 'beef',
      normalized_alias: 'beef',
    }), 'Could not create ingredient alias')

    const ownSearch = await dataOf(a.client.rpc('search_ingredients', { p_query: '牛', p_limit: 30 }), 'Ingredient search failed')
    const isolatedSearch = await dataOf(b.client.rpc('search_ingredients', { p_query: '洋葱', p_limit: 30 }), 'Isolated search failed')
    assert(ownSearch.length === 1 && ownSearch[0].ingredient_id === beefA.id, 'Ingredient search returned wrong user data')
    assert(isolatedSearch.length === 0, 'Ingredient search leaked another user data')

    const matches = await dataOf(a.client.rpc('match_recipe_ingredients', {
      p_items: [{ name: '牛肉' }, { name: 'beef' }, { name: '洋' }, { name: '不存在食材' }],
    }), 'Batch match failed')
    assert(matches[0].matchStatus === 'matched' && matches[0].ingredientId === beefA.id, 'Canonical match failed')
    assert(matches[1].matchStatus === 'matched' && matches[1].matchedBy === 'confirmed_alias', 'Alias match failed')
    assert(matches[2].matchStatus === 'unmatched', 'One-character fuzzy match should be disabled')
    assert(matches[3].matchStatus === 'unmatched', 'Unknown ingredient should remain unmatched')

    const directRecipe = await a.client.from('recipes').insert({ name: `direct-${runId}`, servings: 1 })
    assert(directRecipe.error, 'Direct recipe insert should be denied')

    const idempotencyKey = randomUUID()
    const request = {
      p_name: `番茄炖牛肉 ${runId}`,
      p_servings: 2,
      p_items: [
        { ingredientId: beefA.id, grams: 500 },
        { ingredientId: onionA.id, grams: 200 },
      ],
      p_idempotency_key: idempotencyKey,
    }
    const created = await dataOf(a.client.rpc('create_recipe_with_candidate', request), 'Recipe create failed')
    const repeated = await dataOf(a.client.rpc('create_recipe_with_candidate', request), 'Idempotent recipe retry failed')
    assert(created.recipeId === repeated.recipeId && created.candidateId === repeated.candidateId, 'Idempotent retry created another result')

    const recipeRows = await dataOf(admin.from('recipes').select('id,name,servings').eq('id', created.recipeId), 'Recipe read failed')
    const itemRows = await dataOf(admin.from('recipe_items').select('ingredient_id,grams').eq('recipe_id', created.recipeId), 'Recipe item read failed')
    const candidateRows = await dataOf(admin.from('recipe_candidates').select('id,status').eq('id', created.candidateId), 'Candidate read failed')
    assert(recipeRows.length === 1 && Number(recipeRows[0].servings) === 2, 'Recipe was not created correctly')
    assert(itemRows.length === 2 && candidateRows.length === 1 && candidateRows[0].status === 'candidate', 'Atomic recipe records are incomplete')

    const operation = await dataOf(a.client.rpc('get_operation_result', {
      p_operation_type: 'create_recipe',
      p_idempotency_key: idempotencyKey,
    }), 'Operation lookup failed')
    assert(operation.response.recipeId === created.recipeId, 'Operation lookup returned the wrong result')

    const conflict = await a.client.rpc('create_recipe_with_candidate', { ...request, p_name: `${request.p_name} changed` })
    assert(conflict.error?.message === 'IDEMPOTENCY_CONFLICT', 'Changed idempotent request should conflict', conflict.error)

    const duplicate = await a.client.rpc('create_recipe_with_candidate', { ...request, p_idempotency_key: randomUUID() })
    assert(duplicate.error?.message === 'DUPLICATE_RECIPE_NAME', 'Same recipe name should not overwrite', duplicate.error)

    const beforeFailure = await dataOf(admin.from('recipes').select('id', { count: 'exact', head: true }).eq('user_id', userA.id), 'Failure baseline read failed')
    assert(beforeFailure === null, 'Head select should not return rows')
    const recipeCountBefore = (await admin.from('recipes').select('*', { count: 'exact', head: true }).eq('user_id', userA.id)).count

    const gramsFailure = await a.client.rpc('create_recipe_with_candidate', {
      p_name: `无克重 ${runId}`,
      p_servings: 1,
      p_items: [{ ingredientId: beefA.id, grams: null }],
      p_idempotency_key: randomUUID(),
    })
    assert(gramsFailure.error?.message === 'GRAMS_REQUIRED', 'Missing grams should fail', gramsFailure.error)

    const crossUserFailure = await a.client.rpc('create_recipe_with_candidate', {
      p_name: `跨用户 ${runId}`,
      p_servings: 1,
      p_items: [{ ingredientId: beefB.id, grams: 100 }],
      p_idempotency_key: randomUUID(),
    })
    assert(crossUserFailure.error?.message === 'INVALID_REFERENCE', 'Cross-user ingredient should fail', crossUserFailure.error)

    const recipeCountAfter = (await admin.from('recipes').select('*', { count: 'exact', head: true }).eq('user_id', userA.id)).count
    assert(recipeCountAfter === recipeCountBefore, 'Failed recipe transaction left partial records')

    const directItem = await a.client.from('recipe_items').insert({
      recipe_id: created.recipeId,
      ingredient_id: beefB.id,
      grams: 10,
    })
    assert(directItem.error, 'Direct recipe item insert should be denied')

    const quota = await dataOf(a.client.rpc('claim_recipe_parse_call', {
      p_input_chars: 100,
      p_provider: 'contract_test',
      p_model: 'contract_test',
    }), 'Parse quota claim failed')
    assert(quota.dailyLimit === 10 && quota.monthlyLimit === 100 && quota.maxChars === 20000, 'Parse quota policy is wrong')
    await dataOf(admin.rpc('complete_recipe_parse_call', {
      p_parse_call_id: quota.parseCallId,
      p_status: 'succeeded',
      p_error_code: null,
      p_input_tokens: 50,
      p_output_tokens: 20,
    }), 'Parse call completion failed')

    const directParseRead = await a.client.from('recipe_parse_calls').select('*')
    assert(directParseRead.error, 'Parse usage table should not be directly readable')

    const preflight = await fetch(`${PROJECT_URL}/functions/v1/parse-recipe`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://diet-tracker-one-eta.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info',
      },
    })
    assert(preflight.ok && preflight.headers.get('access-control-allow-origin'), 'Edge Function CORS preflight failed')

    const unauthenticated = await fetch(`${PROJECT_URL}/functions/v1/parse-recipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon },
      body: JSON.stringify({ text: '牛肉 500g' }),
    })
    assert(unauthenticated.status === 401, 'Edge Function should require authentication')

    const configuredCheck = await fetch(`${PROJECT_URL}/functions/v1/parse-recipe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${a.accessToken}`,
      },
      body: JSON.stringify({ text: '番茄炖牛肉\n牛肉 500g\n洋葱半个\n盐少许' }),
    })
    const configuredBody = await configuredCheck.json()
    assert(
      (configuredCheck.status === 503 && configuredBody.error === 'RECIPE_PARSE_NOT_CONFIGURED')
        || (configuredCheck.ok && Array.isArray(configuredBody.items)),
      'Edge Function returned an unexpected configuration result',
      { status: configuredCheck.status, body: configuredBody },
    )

    console.log(JSON.stringify({
      passed: true,
      parseServiceConfigured: configuredCheck.ok,
      checks: [
        'generic ingredient search and user isolation',
        'canonical, alias, and unmatched batch matching',
        'atomic recipe + recipe items + candidate creation',
        'idempotent retry and operation lookup',
        'same-key conflict and duplicate-name protection',
        'missing grams and cross-user rollback',
        'direct recipe table writes denied',
        'parse quota policy and private usage log',
        'Edge Function CORS and JWT protection',
        configuredCheck.ok ? 'real AI parsing' : 'stable not-configured state',
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

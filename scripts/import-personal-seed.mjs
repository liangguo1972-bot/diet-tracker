import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'hgefanuytaryfhsybvhf'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const CLI = process.env.SUPABASE_CLI_PATH
  ?? `${process.env.HOME}/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/dist/supabase.js`
const SEED_SOURCE = 'personal_base_v1'
const APPLY = process.argv.includes('--apply')
const email = valueAfter('--email')
const passwordEnv = valueAfter('--password-env') ?? 'DIET_TRACKER_IMPORT_PASSWORD'
const password = process.env[passwordEnv]

const legacyIngredientNames = {
  鸡胸肉: '鸡胸肉(生)',
  三文鱼: '三文鱼(生)',
  虾: '虾(生,去壳)',
  金枪鱼: '金枪鱼罐头(水浸)',
  豆腐: '嫩豆腐 silken',
  希腊酸奶: '希腊酸奶(脱脂原味)',
  米饭: '米饭(熟)',
  糙米: '糙米(熟)',
  燕麦片: '燕麦(干)',
  红薯: '红薯(熟)',
  甜玉米: '玉米(煮)',
  低脂牛奶: '牛奶(2%)',
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ''}`)
}

function parseCsv(path, { skipTitle = false } = {}) {
  const text = readFileSync(path, 'utf8').replace(/\r/g, '')
  const records = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if (char === '\n' && !quoted) {
      row.push(field)
      if (row.some((value) => value !== '')) records.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field)
    if (row.some((value) => value !== '')) records.push(row)
  }
  if (skipTitle) records.shift()
  const headers = records.shift()?.map((value) => value.trim())
  assert(headers?.length, `CSV header missing: ${path}`)
  return records.map((values, rowIndex) => ({
    ...Object.fromEntries(headers.map((header, index) => [
      header,
      (values[index] ?? '').trim(),
    ])),
    __row: rowIndex + 2 + (skipTitle ? 1 : 0),
  }))
}

function splitList(value) {
  return value.split('、').map((item) => item.trim()).filter(Boolean)
}

function splitSlash(value) {
  return value.split(/\s+\/\s+/).map((item) => item.trim()).filter(Boolean)
}

function normalize(value) {
  return value.trim().toLocaleLowerCase('zh-CN')
}

function normalizeReceipt(value) {
  return value.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '')
}

function receiptTokens(value) {
  return new Set(value.toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}]+/gu).filter(Boolean))
}

function safeKeywordMatches(rawName, keywords) {
  const tokens = receiptTokens(rawName)
  return keywords.some((keyword) => {
    const keywordTokens = keyword.toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}]+/gu).filter(Boolean)
    return keywordTokens.length > 0 && keywordTokens.every((token) => tokens.has(token))
  })
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

async function countOf(operation, label) {
  const { count, error } = await operation
  assert(!error, label, { message: error?.message, details: error?.details, code: error?.code })
  return count ?? 0
}

function parseSources() {
  const ingredients = parseCsv(new URL('../data/基础食材库.csv', import.meta.url))
  const dictionary = parseCsv(new URL('../data/小票匹配词典.csv', import.meta.url))
  const recipes = parseCsv(new URL('../data/菜谱库.csv', import.meta.url), { skipTitle: true })

  assert(ingredients.length === 52, 'Unexpected ingredient source count', { count: ingredients.length })
  assert(dictionary.length === 49, 'Unexpected dictionary source count', { count: dictionary.length })
  assert(recipes.length === 35, 'Unexpected recipe source count', { count: recipes.length })

  const ingredientKeys = new Set()
  for (const row of ingredients) {
    const key = normalize(row['标准匹配名'])
    assert(row['中文标准名'] && key, 'Ingredient name missing', { row: row.__row })
    assert(!ingredientKeys.has(key), 'Duplicate ingredient canonical name', { row: row.__row, key })
    ingredientKeys.add(key)
    for (const field of ['每100g热量kcal', '每100g蛋白g', '每100g碳水g', '每100g脂肪g', '默认份量克重']) {
      assert(Number.isFinite(Number(row[field])) && Number(row[field]) >= 0, 'Ingredient number invalid', { row: row.__row, field })
    }
  }

  for (const row of recipes) {
    const names = splitList(row['主要食材'])
    const grams = splitList(row['每项克重']).map(Number)
    assert(row['菜谱名'] && names.length > 0 && names.length === grams.length, 'Recipe item list mismatch', { row: row.__row })
    assert(grams.every((value) => Number.isFinite(value) && value > 0), 'Recipe grams invalid', { row: row.__row })
    assert(Number(row['默认份数']) > 0, 'Recipe servings invalid', { row: row.__row })
    for (const name of names) {
      assert(ingredientKeys.has(normalize(name)), 'Recipe ingredient missing from base library', { row: row.__row, name })
    }
  }

  return { ingredients, dictionary, recipes }
}

function ingredientPayload(row, userId) {
  const source = row['数据来源']
  const note = row['备注']
  const approximate = /近似|需核实/.test(`${source} ${note}`)
  return {
    user_id: userId,
    name: row['中文标准名'],
    canonical_name: row['标准匹配名'],
    common_name_en: row['英文常见名'] || null,
    category: row['分类'] || null,
    kcal_per_100g: Number(row['每100g热量kcal']),
    protein_per_100g: Number(row['每100g蛋白g']),
    carb_per_100g: Number(row['每100g碳水g']),
    fat_per_100g: Number(row['每100g脂肪g']),
    package_spec: row['默认份量'] || null,
    serving_grams: Number(row['默认份量克重']),
    storage: row['默认存放'] || null,
    is_spec_sensitive: row['是否规格敏感'] === '是',
    is_verified: !approximate,
    nutrition_source: source || null,
    seed_source: SEED_SOURCE,
    note: note || null,
  }
}

async function main() {
  assert(email && password, 'Usage: --email <account> --password-env <ENV_NAME>; password must be supplied via environment')
  const { publishable, serviceRole } = getApiKeys()
  const userClient = client(publishable)
  const admin = client(serviceRole)
  const { data: signedIn, error: signInError } = await userClient.auth.signInWithPassword({ email, password })
  assert(!signInError && signedIn.user, 'Could not locate the requested account', { message: signInError?.message })
  const userId = signedIn.user.id
  const sources = parseSources()

  const existingIngredients = await dataOf(admin.from('ingredients').select('*').eq('user_id', userId), 'Could not read ingredients')
  const existingRecipes = await dataOf(admin.from('recipes').select('*').eq('user_id', userId), 'Could not read recipes')
  const existingAliases = await dataOf(admin.from('ingredient_aliases').select('*').eq('user_id', userId), 'Could not read aliases')
  const existingRules = await dataOf(admin.from('ingredient_match_rules').select('*').eq('user_id', userId), 'Could not read match rules')
  const existingCandidates = await dataOf(admin.from('recipe_candidates').select('*').eq('user_id', userId), 'Could not read candidates')
  const unmatchedInventory = await dataOf(admin.from('inventory').select('*').eq('user_id', userId).is('ingredient_id', null), 'Could not read unmatched inventory')

  const byCanonical = new Map(existingIngredients.map((row) => [normalize(row.canonical_name), row]))
  const byName = new Map(existingIngredients.map((row) => [row.name, row]))
  const ingredientPlan = []
  for (const source of sources.ingredients) {
    const canonical = normalize(source['标准匹配名'])
    const exact = byCanonical.get(canonical)
    const legacyName = legacyIngredientNames[source['标准匹配名']]
    const legacy = legacyName ? byName.get(legacyName) : null
    assert(!(exact && legacy && exact.id !== legacy.id), 'Canonical and legacy ingredient conflict', {
      canonical: source['标准匹配名'],
      exact: exact?.name,
      legacy: legacy?.name,
    })
    ingredientPlan.push({ source, existing: exact ?? legacy ?? null, action: exact || legacy ? 'update' : 'insert' })
  }

  const plannedIngredientsByCanonical = new Map()
  if (APPLY) {
    for (const item of ingredientPlan) {
      const payload = ingredientPayload(item.source, userId)
      if (item.existing) {
        const updated = await dataOf(admin.from('ingredients').update(payload).eq('id', item.existing.id).select().single(), 'Ingredient update failed')
        plannedIngredientsByCanonical.set(normalize(payload.canonical_name), updated)
      } else {
        const inserted = await dataOf(admin.from('ingredients').insert(payload).select().single(), 'Ingredient insert failed')
        plannedIngredientsByCanonical.set(normalize(payload.canonical_name), inserted)
      }
    }
  } else {
    for (const item of ingredientPlan) {
      plannedIngredientsByCanonical.set(normalize(item.source['标准匹配名']), {
        id: item.existing?.id ?? `new:${item.source['标准匹配名']}`,
        name: item.source['中文标准名'],
        canonical_name: item.source['标准匹配名'],
      })
    }
  }

  const skippedDictionaryRows = []
  const rulePlan = []
  for (const row of sources.dictionary) {
    const target = row['建议匹配到的中文食材']
    if (target === '蛋白棒' || target === '蛋白粉') {
      skippedDictionaryRows.push({ row: row.__row, target, reason: '营养标签强相关，产品决定暂不导入' })
      continue
    }
    const ingredient = plannedIngredientsByCanonical.get(normalize(target))
    assert(ingredient, 'Dictionary target ingredient missing', { row: row.__row, target })
    const risk = row['匹配风险'] === '安全'
      ? 'safe'
      : row['匹配风险'] === '高风险' ? 'high_risk' : 'needs_confirm'
    for (const alias of splitSlash(row['可能出现的完整商品写法'])) {
      rulePlan.push({
        ingredient,
        alias,
        normalizedAlias: normalizeReceipt(alias),
        keywords: splitSlash(row['小票关键词']),
        ignoredTerms: row['可忽略词'].split('、').map((term) => term.trim()).filter(Boolean),
        risk,
        reason: row['原因说明'] || null,
      })
    }
  }

  const existingRuleByAlias = new Map(existingRules.map((row) => [row.normalized_alias, row]))
  const existingAliasByAlias = new Map(existingAliases.map((row) => [row.normalized_alias, row]))
  const ruleConflicts = []
  const aliasConflicts = []
  const desiredRuleAliases = new Set(rulePlan.map((rule) => rule.normalizedAlias))
  const staleRules = existingRules.filter((row) =>
    row.source === 'personal_seed' && !desiredRuleAliases.has(row.normalized_alias))

  if (APPLY) {
    if (staleRules.length > 0) {
      await dataOf(admin.from('ingredient_match_rules').delete().in('id', staleRules.map((row) => row.id)), 'Stale match rule cleanup failed')
    }
    for (const ingredient of plannedIngredientsByCanonical.values()) {
      const normalizedAlias = normalizeReceipt(ingredient.canonical_name)
      const existing = existingAliasByAlias.get(normalizedAlias)
      if (existing && existing.ingredient_id !== ingredient.id) {
        aliasConflicts.push({ alias: ingredient.canonical_name, reason: '已指向其他食材' })
      } else {
        await dataOf(admin.from('ingredient_aliases').upsert({
          user_id: userId,
          ingredient_id: ingredient.id,
          alias: ingredient.canonical_name,
          normalized_alias: normalizedAlias,
          source: 'personal_seed',
        }, { onConflict: 'user_id,normalized_alias' }), 'Canonical alias upsert failed')
      }
    }

    for (const rule of rulePlan) {
      const oldRule = existingRuleByAlias.get(rule.normalizedAlias)
      if (oldRule && oldRule.ingredient_id !== rule.ingredient.id) {
        ruleConflicts.push({ alias: rule.alias, reason: '已有规则指向其他食材' })
        continue
      }
      await dataOf(admin.from('ingredient_match_rules').upsert({
        user_id: userId,
        ingredient_id: rule.ingredient.id,
        alias: rule.alias,
        normalized_alias: rule.normalizedAlias,
        keywords: rule.keywords,
        ignored_terms: rule.ignoredTerms,
        match_risk: rule.risk,
        reason: rule.reason,
        source: 'personal_seed',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,normalized_alias' }), 'Match rule upsert failed')

      if (rule.risk === 'safe') {
        const oldAlias = existingAliasByAlias.get(rule.normalizedAlias)
        if (oldAlias && oldAlias.ingredient_id !== rule.ingredient.id) {
          aliasConflicts.push({ alias: rule.alias, reason: '已有别名指向其他食材' })
        } else {
          await dataOf(admin.from('ingredient_aliases').upsert({
            user_id: userId,
            ingredient_id: rule.ingredient.id,
            alias: rule.alias,
            normalized_alias: rule.normalizedAlias,
            source: 'personal_seed',
          }, { onConflict: 'user_id,normalized_alias' }), 'Safe alias upsert failed')
        }
      }
    }
  }

  const recipePlan = []
  const recipeByName = new Map(existingRecipes.map((row) => [normalize(row.name), row]))
  const recipeBySeed = new Map(existingRecipes.filter((row) => row.seed_key).map((row) => [row.seed_key, row]))
  const candidateByRecipe = new Map(existingCandidates.map((row) => [row.recipe_id, row]))

  for (const row of sources.recipes) {
    const seedKey = normalizeReceipt(row['菜谱名'])
    const existing = recipeBySeed.get(seedKey) ?? recipeByName.get(normalize(row['菜谱名'])) ?? null
    const ingredientNames = splitList(row['主要食材'])
    const grams = splitList(row['每项克重']).map(Number)
    const items = ingredientNames.map((name, index) => ({
      ingredient: plannedIngredientsByCanonical.get(normalize(name)),
      grams: grams[index],
    }))
    assert(items.every((item) => item.ingredient), 'Recipe ingredient resolution failed', { recipe: row['菜谱名'] })
    recipePlan.push({
      row,
      seedKey,
      existing,
      items,
      candidate: row['默认是否加入候选菜池'] === '是',
    })
  }

  let recipesCreated = 0
  let recipesUpdated = 0
  let candidatesCreated = 0
  let nextCandidatePosition = existingCandidates.reduce((maximum, row) => Math.max(maximum, Number(row.position)), -1) + 1
  if (APPLY) {
    for (const plan of recipePlan) {
      const noteParts = []
      if (plan.row['默认忽略项']) noteParts.push(`默认忽略：${plan.row['默认忽略项']}`)
      if (plan.row['备注']) noteParts.push(plan.row['备注'])
      const recipePayload = {
        user_id: userId,
        name: plan.row['菜谱名'],
        role: plan.row['分类标签'] || null,
        servings: Number(plan.row['默认份数']),
        note: noteParts.join('；') || null,
        seed_key: plan.seedKey,
        seed_source: SEED_SOURCE,
      }
      let recipe
      if (plan.existing) {
        recipe = await dataOf(admin.from('recipes').update(recipePayload).eq('id', plan.existing.id).select().single(), 'Recipe update failed')
        await dataOf(admin.from('recipe_items').delete().eq('recipe_id', recipe.id), 'Old recipe items cleanup failed')
        recipesUpdated += 1
      } else {
        recipe = await dataOf(admin.from('recipes').insert(recipePayload).select().single(), 'Recipe insert failed')
        recipesCreated += 1
      }
      await dataOf(admin.from('recipe_items').insert(plan.items.map((item) => ({
        recipe_id: recipe.id,
        ingredient_id: item.ingredient.id,
        grams: item.grams,
      }))), 'Recipe items insert failed')

      if (plan.candidate && !candidateByRecipe.has(recipe.id)) {
        await dataOf(admin.from('recipe_candidates').insert({
          user_id: userId,
          recipe_id: recipe.id,
          status: 'candidate',
          position: nextCandidatePosition,
        }), 'Candidate insert failed')
        nextCandidatePosition += 1
        candidatesCreated += 1
      }
    }
  }

  const safeRuleGroups = new Map()
  for (const row of sources.dictionary) {
    const target = row['建议匹配到的中文食材']
    if (target === '蛋白棒' || target === '蛋白粉' || row['匹配风险'] !== '安全') continue
    const ingredient = plannedIngredientsByCanonical.get(normalize(target))
    const group = safeRuleGroups.get(ingredient.id) ?? { ingredient, aliases: [], keywords: [] }
    group.aliases.push(...splitSlash(row['可能出现的完整商品写法']).map(normalizeReceipt))
    group.keywords.push(...splitSlash(row['小票关键词']))
    safeRuleGroups.set(ingredient.id, group)
  }

  const inventoryConversions = []
  const inventoryAmbiguous = []
  for (const lot of unmatchedInventory) {
    const rawName = lot.receipt_raw_name || lot.display_name || ''
    const normalizedRaw = normalizeReceipt(rawName)
    const matches = [...safeRuleGroups.values()].filter((group) =>
      group.aliases.includes(normalizedRaw) || safeKeywordMatches(rawName, group.keywords))
    if (matches.length === 1) {
      inventoryConversions.push({ lot, ingredient: matches[0].ingredient, rawName })
    } else if (matches.length > 1) {
      inventoryAmbiguous.push({ inventoryId: lot.id, rawName, reason: '同时命中多个安全规则' })
    }
  }

  if (APPLY) {
    for (const conversion of inventoryConversions) {
      await dataOf(admin.from('inventory').update({
        ingredient_id: conversion.ingredient.id,
        updated_at: new Date().toISOString(),
      }).eq('id', conversion.lot.id).is('ingredient_id', null), 'Inventory conversion failed')

      if (conversion.lot.receipt_item_id) {
        await dataOf(admin.from('receipt_items').update({
          ingredient_id: conversion.ingredient.id,
          suggested_ingredient_id: null,
          suggested_name: null,
          suggestion_confidence: null,
          suggestion_reason: null,
          suggestion_source: null,
          match_status: 'matched',
          match_confidence: 1,
          updated_at: new Date().toISOString(),
        }).eq('id', conversion.lot.receipt_item_id).is('ingredient_id', null), 'Receipt item conversion failed')
      }

      const normalizedAlias = normalizeReceipt(conversion.rawName)
      const oldAlias = existingAliasByAlias.get(normalizedAlias)
      if (!oldAlias || oldAlias.ingredient_id === conversion.ingredient.id) {
        await dataOf(admin.from('ingredient_aliases').upsert({
          user_id: userId,
          ingredient_id: conversion.ingredient.id,
          alias: conversion.rawName,
          normalized_alias: normalizedAlias,
          source: 'seed_inventory_conversion',
        }, { onConflict: 'user_id,normalized_alias' }), 'Converted inventory alias upsert failed')
      }
    }
  }

  const safeAliases = rulePlan.filter((rule) => rule.risk === 'safe').length
  const reviewRules = rulePlan.filter((rule) => rule.risk !== 'safe').length
  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    account: email,
    source: {
      ingredients: sources.ingredients.length,
      dictionaryRows: sources.dictionary.length,
      recipes: sources.recipes.length,
    },
    ingredients: {
      toCreate: ingredientPlan.filter((item) => item.action === 'insert').length,
      toUpdate: ingredientPlan.filter((item) => item.action === 'update').length,
      totalImported: ingredientPlan.length,
    },
    receiptDictionary: {
      safeAliases,
      reviewOnlyRules: reviewRules,
      totalRules: rulePlan.length,
      skippedRows: skippedDictionaryRows,
      staleRulesToRemove: staleRules.map((row) => row.alias),
      ruleConflicts,
      aliasConflicts,
    },
    recipes: {
      toCreate: recipePlan.filter((item) => !item.existing).length,
      toRefresh: recipePlan.filter((item) => item.existing).length,
      candidateDefaults: recipePlan.filter((item) => item.candidate).length,
      created: APPLY ? recipesCreated : null,
      refreshed: APPLY ? recipesUpdated : null,
      candidatesCreated: APPLY ? candidatesCreated : null,
    },
    inventory: {
      unmatchedBefore: unmatchedInventory.length,
      safeConversions: inventoryConversions.map((item) => ({
        inventoryId: item.lot.id,
        rawName: item.rawName,
        ingredient: item.ingredient.name,
      })),
      ambiguous: inventoryAmbiguous,
    },
  }

  if (APPLY) {
    report.remoteAfter = {
      ingredients: await countOf(admin.from('ingredients').select('*', { head: true, count: 'exact' }).eq('user_id', userId), 'Final ingredient count failed'),
      aliases: await countOf(admin.from('ingredient_aliases').select('*', { head: true, count: 'exact' }).eq('user_id', userId), 'Final alias count failed'),
      matchRules: await countOf(admin.from('ingredient_match_rules').select('*', { head: true, count: 'exact' }).eq('user_id', userId), 'Final rule count failed'),
      recipes: await countOf(admin.from('recipes').select('*', { head: true, count: 'exact' }).eq('user_id', userId), 'Final recipe count failed'),
      candidates: await countOf(admin.from('recipe_candidates').select('*', { head: true, count: 'exact' }).eq('user_id', userId), 'Final candidate count failed'),
      unmatchedInventory: await countOf(admin.from('inventory').select('*', { head: true, count: 'exact' }).eq('user_id', userId).is('ingredient_id', null), 'Final inventory count failed'),
    }
  }

  console.log(JSON.stringify(report, null, 2))
  await userClient.auth.signOut()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

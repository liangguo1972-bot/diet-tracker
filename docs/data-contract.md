# Diet Tracker · 前后端数据契约

最后更新：2026-07-15

## 1. 这份文档的作用

这份文档是前端与后端之间的唯一接口依据。

优先级从高到低：

1. `supabase/migrations/` 中已经应用的数据库迁移。
2. 本文中标记为「已支持」的契约。
3. Figma 中的界面与交互需求。
4. Excel 中的数据内容和未来构想。

Figma 可以提出新的数据需求，但不能自行增加数据库字段。Excel 可以作为导入来源，但不能直接代表当前数据库结构。

## 2. 第一版范围

第一版已支持两条已验证链路：

1. 用户登录。
2. 打开后查看今天的营养汇总和各餐。
3. 新建一餐。
4. 一餐可以添加多个成品或单品。
5. 保存后返回今天页面，并看到更新后的营养数据。
6. 采购候选菜池、周计划和采购清单。
7. 采购完成写入真实库存批次。
8. 从库存做饭，保存真实成品并扣减库存。
9. 从成品选择器记餐，并查看今天营养。
10. 照片小票上传、人工确认后写入库存，并匹配已有食材。

第一版不包含 PDF、营养标签识别、自动创建食材、单品选择器扩展、低量阈值、临期规则、替代食材、不同单位换算、库存手工调整、撤销已做成品、趋势、周报和身体数据。照片识别依赖服务器端 OCR 配置。没有配置时会返回明确失败状态。

## 3. 连接方式

前端使用 `@supabase/supabase-js` 直接连接 Supabase，不增加自建服务器。

前端环境变量：

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

前端禁止使用 secret key 或 service role key。所有业务读取和写入都必须在用户登录后进行。

## 4. 当前远端数据库

### 已支持的表

| 表 | 作用 |
|---|---|
| `ingredients` | 食材营养和标准份量 |
| `recipes` | 配方参考模板 |
| `recipe_items` | 配方包含的参考食材和克数 |
| `cook_sessions` | 某次实际做出的成品 |
| `cook_items` | 该次做饭实际使用的食材和克数 |
| `meals` | 一顿饭的日期和餐次 |
| `meal_items` | 一顿饭中的成品或单品，`position` 保存显示顺序 |
| `targets` | 每日热量和蛋白目标，每位用户一条 |
| `inventory` | 真实库存批次。`quantity` 为当前可用量，`unit` 为原始量词，`grams_per_unit` 只在后端有可信来源时填写 |
| `inventory_movements` | 不可直接写入的库存流水。记录采购和做饭扣减 |
| `recipe_candidates` | 用户的候选菜池状态和顺序 |
| `weekly_plans` | 每周计划主记录 |
| `weekly_plan_items` | 每周计划中的食谱、日期、份数和顺序 |
| `shopping_lists` | 由周计划生成的采购清单主记录 |
| `shopping_list_items` | 合并后的食材需求、库存覆盖量和采购完成状态 |
| `operation_requests` | `complete_purchase`、`save_cook_session` 与 `confirm_receipt_import` 的幂等结果 |
| `receipt_imports` | 私有照片上传、识别状态、原始文本与确认时间 |
| `receipt_items` | 小票商品行、匹配建议、人工确认结果与入库库存批次 |
| `ingredient_aliases` | 当前用户确认过的商品别名到已有食材的映射 |
| `cook_unmatched_items` | 做饭时使用的未匹配库存。它不携带营养数据。 |
| `body_metrics` | 身体数据留位，当前为空 |

### 已支持的 View

| View | 作用 |
|---|---|
| `recipe_nutrition` | 配方整批和每份营养 |
| `cook_nutrition` | 实际成品整批和每份营养 |
| `meal_nutrition` | 每顿饭营养合计 |
| `daily_summary` | 每日营养合计 |

四个 View 已启用 `security_invoker`，会遵守底层表的 RLS。

## 5. 共同数据类型

```ts
export type MealType =
  | '早餐'
  | '早午餐'
  | '午餐'
  | '晚餐'
  | '加餐'

export type Nutrition = {
  kcal: number
  protein: number
  carb: number
  fat: number
}

export type MealItemInput =
  | {
      sourceType: 'cook_session'
      cookSessionId: string
      servings: number
    }
  | {
      sourceType: 'ingredient'
      ingredientId: string
      servings: number
    }

export type SaveMealInput = {
  eatenOn: string
  mealType: MealType
  note?: string
  items: MealItemInput[]
}

export type MealComponentRow = {
  source_type: 'cook_session' | 'ingredient'
  source_id: string
  name: string
  subtitle: string
  serving_grams: number | null
  available_servings: number | null
  per_serving_kcal: number
  per_serving_protein: number
  per_serving_carb: number
  per_serving_fat: number
  estimated: boolean
  last_used_on: string | null
}
```

日期统一使用 `YYYY-MM-DD`。份数允许小数，但必须大于 0。

每个 `meal_item` 必须且只能引用一个来源：`cook_session_id` 或 `ingredient_id`。

## 6. 前端读取契约

### 6.1 今天页面

前端需要得到：

```ts
export type TodayData = {
  date: string
  total: Nutrition
  target: {
    kcal: number | null
    protein: number | null
  }
  meals: Array<{
    id: string
    mealType: MealType
    note: string | null
    nutrition: Nutrition
    items: Array<{
      id: string
      sourceType: 'cook_session' | 'ingredient'
      sourceId: string
      name: string
      servings: number
      nutrition: Nutrition
      estimated: boolean
    }>
  }>
}
```

状态：**已支持**。

调用：

```ts
const { data, error } = await supabase.rpc('get_today', {
  p_date: '2026-07-12',
})
```

`get_today` 一次返回 `TodayData`。无记录时，`total` 四项为 0，`meals` 为空数组。

### 6.2 成品选择器

数据来源：`cook_sessions` 联合 `cook_nutrition`。

前端需要：成品名称、制作日期、每份营养、是否为估算值、可吃份数。

状态：**已支持**。

调用：

```ts
const { data, error } = await supabase.rpc('search_meal_components', {
  p_source_type: 'cook_session',
  p_query: '',
})
```

接口返回名称、制作日期、每份营养、「估」标记、最近使用日期和剩余份数。剩余份数小于等于 0 的成品不会返回。

### 6.3 单品选择器

数据来源：`ingredients`。

只有 `serving_grams` 不为空的食材才能直接作为单品选择。每份营养由 `serving_grams / 100 × 每100g营养` 得到。

状态：**已支持**。

当前 63 个食材中只有 11 个填写了 `serving_grams`。

调用 `search_meal_components`，把 `p_source_type` 设为 `ingredient`。只有已填写 `serving_grams` 的食材会返回。

## 7. 前端写入契约

### 保存一餐

目标接口：

```ts
saveMeal(input: SaveMealInput): Promise<{ mealId: string }>
```

状态：**已支持**。

调用：

```ts
const { data: mealId, error } = await supabase.rpc('save_meal', {
  p_eaten_on: input.eatenOn,
  p_meal_type: input.mealType,
  p_note: input.note ?? '',
  p_items: input.items,
})
```

`save_meal` 在同一事务中完成：

1. 验证用户身份。
2. 验证日期、餐次、份数和来源。
3. 插入 `meals`。
4. 插入全部 `meal_items`。
5. 任一步失败时回滚整餐。

前端不得自行连续插入 `meals` 和 `meal_items`。

### 编辑一餐

目标接口：

```ts
updateMeal(mealId: string, input: SaveMealInput): Promise<void>
```

状态：**已支持**。

调用：

```ts
const { error } = await supabase.rpc('update_meal', {
  p_meal_id: mealId,
  p_eaten_on: input.eatenOn,
  p_meal_type: input.mealType,
  p_note: input.note ?? '',
  p_items: input.items,
})
```

编辑在同一事务中更新餐信息并替换全部组分。任何一步失败时，原记录保持不变。

## 8. 加载、空和错误状态

前端必须处理：

- 未登录：进入登录页。
- 加载中：显示骨架状态。
- 今天无记录：显示空状态和「记一餐」。
- 选择器无结果：显示无匹配项。
- 保存失败：保留用户已经填写的内容并允许重试。
- 数据库权限错误：不降级使用匿名数据。

### 8.1 已验证的 RPC 错误与重复请求语义

以下行为已在远端 Supabase 用两个隔离登录用户验证：

| 场景 | 远端行为 | 前端处理 |
|---|---|---|
| 未登录调用 RPC | PostgREST 在执行函数前拒绝请求，`get_today` 返回 `permission denied for function get_today` | 进入登录页，不显示匿名或缓存饮食数据 |
| 引用不存在或其他用户的单品 | `save_meal` / `update_meal` 返回 `Selectable ingredient not found` | 保留草稿，提示重新选择单品 |
| 修改其他用户的餐 | `update_meal` 返回 `Meal not found` | 关闭编辑或返回今天页面，并重新读取数据 |
| `save_meal` 或 `update_meal` 的任一条目无效 | 整个 RPC 回滚，原餐和已有餐次保持不变 | 保留草稿，允许用户修正后重试 |
| 相同 `save_meal` 请求连续发送两次 | 当前会创建两条独立餐次。接口没有幂等键 | 保存按钮在请求完成前必须禁用；网络失败后不能自动重试保存 |

### 8.2 厨房与采购接口

状态：**已支持并已在远端验证**。所有调用都要求登录。读取接口返回真实数据或真实空结果。页面不能用 Figma 样例代替返回结果。

#### 读取接口

| 页面 | 调用 | 返回重点 |
|---|---|---|
| 厨房首页 | `get_kitchen_home({ p_date? })` | 库存批次数、临期批次数、本周计划和仍可食用成品 |
| 库存列表 | `list_inventory({ p_query?, p_status? })` | 批次、食材名称、当前数量、原始单位、可信克重、存放位置、到期日和状态 |
| 做饭准备 | `get_cook_preparation({ p_recipe_id, p_plan_item_id? })` | 食谱参考克重、可选库存批次、仅以 `g` 可直接比较的可用克重，以及 `ready`、`partial`、`missing`、`unit_confirmation_required` 状态 |
| 厨房食材选择器 | `search_cook_inventory({ p_query? })` | 当前用户仍有数量的库存批次及其单位和可信克重标记 |
| 候选菜池 | `list_recipe_candidates()` | 用户候选状态、顺序、食谱份数和营养验证标记 |
| 候选随机抽取 | `draw_recipe_candidates({ p_count? })` | 从 `wanted`、`candidate`、`kept` 中随机抽取的真实食谱。它不包含推荐算法。 |
| 周计划 | `get_weekly_plan({ p_week_start })` | 该周计划或 `plan: null`，以及已保存条目 |
| 采购清单 | `get_shopping_list({ p_weekly_plan_id })` | 已生成清单或 `null`，包括参考克重、同为 `g` 的库存覆盖量、待购量和完成状态 |
| 网络结果确认 | `get_operation_result({ p_operation_type, p_idempotency_key })` | 对应成功结果或 `null`，用于网络结果未知后的确认 |

#### 写入接口

候选状态调用：

```ts
await supabase.rpc('set_recipe_candidate_status', {
  p_recipe_id: recipeId,
  p_status: 'wanted' | 'candidate' | 'kept' | 'skipped',
  p_position: 0,
})
```

周计划调用：

```ts
await supabase.rpc('save_weekly_plan', {
  p_week_start: '2026-07-13',
  p_status: 'draft' | 'confirmed',
  p_items: [{
    recipeId,
    scheduledOn: '2026-07-13',
    plannedServings: 2,
    position: 0,
    source: 'manual' | 'candidate_draw',
  }],
})

await supabase.rpc('generate_shopping_list', {
  p_weekly_plan_id: weeklyPlanId,
})
```

采购完成调用：

```ts
await supabase.rpc('complete_purchase', {
  p_shopping_list_id: shoppingListId,
  p_idempotency_key: crypto.randomUUID(),
  p_items: [{
    shoppingListItemId,
    quantity: 1,
    unit: '盒',
    storage: '冷藏',
    purchaseDate: '2026-07-13',
    expiresOn: null,
    gramsPerUnit: 500, // 只有可信来源才传入
    note: '',
  }],
})
```

采购完成在一个事务中创建库存批次、写入 `purchase` 流水、更新清单条目和清单状态。清单可分次完成。相同幂等键和相同请求返回第一次结果，不再写入库存或流水。

保存成品调用：

```ts
await supabase.rpc('save_cook_session', {
  p_recipe_id: recipeId,
  p_name: '鸡胸肉碗',
  p_cooked_on: '2026-07-13',
  p_total_servings: 2,
  p_note: '',
  p_idempotency_key: crypto.randomUUID(),
  p_items: [{
    inventoryId,
    ingredientId,
    quantityUsed: 0.5,
    unit: '盒',
    note: '',
  }],
  p_unmatched_items: [{
    inventoryId: unmatchedInventoryId,
    quantityUsed: 0.5,
    unit: '盒',
    note: '',
  }], // 可选。只用于 ingredient_id 为空的库存，不产生营养数据。
})
```

保存成品在一个事务中锁定选中的库存批次、验证食谱和单位、扣减库存、写入 `cook_consumption` 流水、创建 `cook_sessions` 和 `cook_items`。成功后，前端重新请求 `search_meal_components({ p_source_type: 'cook_session', p_query: '' })`，不能把本地草稿直接插入成品选择器。

#### 单位和营养规则

库存扣减数量与营养克重分开保存。用户可以手动记录 `1 个`、`1 盒`、`1 把`、`1 碗` 等明确量词；同一批次允许按相同量词扣减，例如 `1 盒` 扣 `0.5 盒`。单位不一致时后端返回 `UNIT_CONFLICT`，前端不能自行换算。

营养克重只来自后端已有的食谱克重、`g` 单位库存、或库存中已有可信 `grams_per_unit`。没有可信克重的量词库存仍可扣减，营养继续使用食谱中已确认的参考克重。前端不得把个、盒、把或碗推算为克。

库存、库存流水、采购完成和保存成品没有直接表写入权限。它们只能通过上述 RPC 改变。

#### FR-002 错误码与前端行为

新增业务错误以 `error.message` 返回下列稳定码。数据库网络中断不会保证收到错误码，此时前端使用原幂等键调用 `get_operation_result`，或以同一键手动重试。

| 错误码 | 含义 | 前端行为 |
|---|---|---|
| `AUTH_REQUIRED` | RPC 内未取得登录用户 | 回到登录页，不显示缓存的他人数据 |
| `INVALID_REFERENCE` | 引用不存在或不属于当前用户 | 保留草稿，重新读取选择器、计划或清单 |
| `QUANTITY_INVALID` | 数量、日期、状态或输入格式不合法 | 标出提交项并保留草稿 |
| `UNIT_CONFLICT` | 扣减单位与库存批次单位不一致 | 不换算，要求选择同单位批次 |
| `INSUFFICIENT_STOCK` | 任一库存批次不足 | 整次成品保存回滚，保留草稿 |
| `CONFLICT` | 已完成清单、已完成采购对应计划或其他状态冲突 | 重新读取页面后由用户决定 |
| `IDEMPOTENCY_CONFLICT` | 相同幂等键提交了不同内容 | 不自动重试，生成新操作前先让用户确认 |
| `FORBIDDEN` 或数据库权限错误 | 未授权访问或试图绕过 RPC 直接写表 | 不显示匿名数据，必要时回登录页 |
| `NETWORK_UNKNOWN` | 浏览器未取得响应，服务端结果可能已提交 | 不创建新幂等键，查询原键结果或原键重试 |

### 8.3 照片小票导入库存接口

状态：**已支持并已在远端验证**。只支持 JPEG、PNG、WebP，单张最大 10 MB。图片保存于私有 `receipt-source` bucket，前端不能使用公开 URL 或任何 secret key。

流程固定为“创建导入任务 → 上传到返回路径 → 调用识别函数 → 修改草稿 → 确认入库”。小票商品不会直接加入记餐单品选择器。

```ts
const { data: created, error: createError } = await supabase.rpc('create_receipt_import', {
  p_file_name: file.name,
  p_content_type: file.type,
  p_file_size_bytes: file.size,
  p_file_hash: sha256Hex, // 可选。相同文件会返回已有任务。
})

await supabase.storage.from('receipt-source').upload(created.storagePath, file, {
  contentType: file.type,
  upsert: false,
})

await supabase.functions.invoke('process-receipt', {
  body: {
    receiptImportId: created.receiptImportId,
    imageBase64: compressedForOcr,
    imageContentType: 'image/jpeg',
  },
})
```

`process-receipt` 只接受已登录用户。当前远端已接入 Azure Document Intelligence `prebuilt-receipt`。Azure endpoint 和 key 只保存在 Supabase Secrets，不进入浏览器或仓库。

原图仍按 10 MB 上限上传并保存在私有 `receipt-source`。Azure F0 单文件上限为 4 MB，Supabase 免费 Edge Function 无法稳定压缩大于 5 MB 的图片。因此前端会在浏览器内把大图缩放为最长边 2400 像素、3.5 MB 以下的临时 JPEG，并随识别请求发送。临时副本不另行保存。Edge Function 仍会验证登录、导入归属和私有原图确实存在，再把临时副本发送给 Azure。重试旧导入时，前端从用户自己的私有路径下载原图并重新生成临时副本。

2026-07-15 已用 9.49 MB、4032×3024 的 Whole Foods PNG 完成 Production 浏览器端验证。浏览器生成的识别副本约 1.06 MB，Azure 返回 13 条商品行，页面真实进入“确认小票”，状态为 `ready_for_review`。13 条名称、识别出的数量和价格均写入真实草稿；确认入库仍必须由用户完成。

草稿读取和确认：

```ts
const { data: draft } = await supabase.rpc('get_receipt_import', {
  p_receipt_import_id: receiptImportId,
})

await supabase.rpc('update_receipt_items', {
  p_receipt_import_id: receiptImportId,
  p_items: draft.items.map((item) => ({
    receiptItemId: item.receiptItemId,
    ingredientId: item.ingredientId ?? null,
    action: 'add_to_inventory', // 或 'ignore'
    confirmedName: item.confirmedName ?? item.rawName,
    confirmedQuantity: item.confirmedQuantity,
    confirmedUnit: item.confirmedUnit,
    storage: '冷藏',
  })),
})

await supabase.rpc('confirm_receipt_import', {
  p_receipt_import_id: receiptImportId,
  p_idempotency_key: crypto.randomUUID(),
})
```

`update_receipt_items` 必须一次提交该导入的全部商品行。`add_to_inventory` 行必须有确认名称、正数数量和量词。选择已有食材时，`ingredientId` 必须属于当前用户。`ingredientId: null` 表示未匹配库存占位。确认成功后，后端在一个事务中创建库存和 `purchase` 流水，并回写每行的 `inventoryId`。

匹配优先级是用户已确认别名、已有食材同名、低置信度推荐。推荐项仍需用户确认。未匹配库存可以被 `search_cook_inventory` 返回，并可通过 `save_cook_session.p_unmatched_items` 按相同量词扣减，但不会写入 `cook_items`，因此不能成为可靠营养来源或单品选择器结果。

| 错误码 | 前端行为 |
|---|---|
| `RECEIPT_FILE_INVALID` | 阻止上传，提示只使用支持格式和 10 MB 以下图片。 |
| `OCR_NOT_CONFIGURED` | 保留上传记录，提示识别服务尚未配置。不要显示商品草稿。 |
| `OCR_UNAVAILABLE`、`OCR_RESPONSE_INVALID`、`RECEIPT_FILE_UNAVAILABLE` | 保留上传记录并允许使用同一任务重试。 |
| `RECEIPT_RECOGNITION_INVALID` | 提示识别结果无效，保留原图和失败状态。 |
| `STATUS_CONFLICT` | 重新读取导入任务。已确认任务不能再次入库。 |
| `IDEMPOTENCY_CONFLICT` | 同一确认键已用于不同内容。不要自动新建键。 |
| `INVALID_REFERENCE`、`AUTH_REQUIRED` | 不透露其他用户导入是否存在。回登录或重新读取当前列表。 |

同一文件哈希会返回已有导入任务。`confirm_receipt_import` 使用幂等键：同键同内容返回第一次成功结果，同键不同内容返回 `IDEMPOTENCY_CONFLICT`。确认后的导入使用新键会返回 `STATUS_CONFLICT`，不会再次写库存。

## 9. 新需求处理规则

当 Figma 出现本文没有的数据时：

1. 前端对话在本文末尾记录需求，不自行增加字段。
2. 后端对话判断是否能由现有数据计算。
3. 只有无法计算时才新增字段、View 或 RPC。
4. 后端迁移完成并验证后，把状态改为「已支持」。
5. 前端再开始连接真实数据。

## 10. 当前后端待办顺序

1. 补齐第一版可选单品的 `serving_grams`。
2. 将 Excel v8 新增食材、配方和真实饮食数据转换为当前四层模型。
3. 前端真实 Supabase 联调 `get_today`、`search_meal_components`、`save_meal` 和 `update_meal`。**已完成。**
4. FR-002 厨房与采购真实数据闭环。**后端已完成并验证，等待前端接入。**

## 11. 新需求记录

### 2026-07-13 · FR-002 前端接入发现

以下能力当前未支持，前端只显示真实空结果或明确限制，不自行补数据：

1. `get_shopping_list` 会返回 `toPurchaseGrams = 0` 且状态仍为 `pending` 的库存已覆盖条目。`complete_purchase` 又要求提交数量大于 0，当前没有“无需采购”或自动完成条目的能力。因此前端不为这类条目制造购买数量，也不能把它们误报为已完成。后端需要确认生成时自动完成、增加跳过能力，或调整清单完成判定。
2. `list_recipe_candidates` 只返回已经进入候选菜池的食谱。候选菜池为空时，现有契约没有可供前端发现其他真实食谱并加入候选池的读取能力。第一版前端只能显示空状态，不能用 Figma 样例补齐。

### 2026-07-15 · Figma v2 确认页与添加菜谱缺口

以下能力当前未支持。前端只提供明确受限的本地草稿或人工确认，不自行新增字段和接口：

1. 小票条目在 `add_to_inventory` 时仍必须提交 `confirmedUnit`。OCR 没有识别出可靠量词时，当前契约没有推荐量词、允许无量词入库或标准化量词来源。前端必须要求用户输入量词，不能默认编造 `个`、`盒` 或其他单位。
2. `get_receipt_import` 没有返回数量置信度或“疑似价格”标记。前端暂时只在 `rawQuantity` 与 `rawPrice` 相同且 `rawUnit` 为空时清空预填数量并要求人工确认。后端需要评估是否由 OCR 映射层返回稳定判断，避免前端扩大推断规则。
3. 小票确认页没有搜索当前用户可用食材并选择 `ingredientId` 的已支持接口。当前只能接受后端返回的已有建议、改为未匹配库存占位或忽略。
4. 添加菜谱页没有创建菜谱、创建食材明细、加入候选菜池或直接加入本周计划的已支持契约。粘贴解析也没有已支持服务。前端只提供本地草稿界面并明确禁用真实保存，不显示成功状态。

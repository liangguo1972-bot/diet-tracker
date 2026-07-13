# Diet Tracker · 前后端数据契约

最后更新：2026-07-12

## 1. 这份文档的作用

这份文档是前端与后端之间的唯一接口依据。

优先级从高到低：

1. `supabase/migrations/` 中已经应用的数据库迁移。
2. 本文中标记为「已支持」的契约。
3. Figma 中的界面与交互需求。
4. Excel 中的数据内容和未来构想。

Figma 可以提出新的数据需求，但不能自行增加数据库字段。Excel 可以作为导入来源，但不能直接代表当前数据库结构。

## 2. 第一版范围

第一版只闭合「记录」链路：

1. 用户登录。
2. 打开后查看今天的营养汇总和各餐。
3. 新建一餐。
4. 一餐可以添加多个成品或单品。
5. 保存后返回今天页面，并看到更新后的营养数据。
6. 厨房和采购只显示占位页。

第一版不包含库存、采购清单、随机菜单、趋势、周报和身体数据。

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
| `inventory` | 库存留位，当前为空 |
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
4. 根据 Figma 新需求继续更新本契约。

## 11. 新需求记录

尚无。

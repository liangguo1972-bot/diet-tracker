# Diet Tracker 前端

## 启动

```bash
cp .env.example .env.local
npm install
npm run dev
```

在 `.env.local` 中填写：

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

登录使用 Supabase 邮箱与密码认证。今日页调用 `get_today`，成品和单品选择器调用 `search_meal_components`，新建与编辑分别调用 `save_meal` 和 `update_meal`。

业务数据只在登录后读取和写入。保存或编辑失败时，当前草稿会留在页面中供用户重试。

## 构建

```bash
npm run build
```

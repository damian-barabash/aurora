# AURORA

Штаб знаний фирмы: продукты, цены, даты, коммуникаты и бренд в одном месте. База обновляется сама —
из почты и календаря сотрудников, сайта фирмы, документов и разговоров с Claude (MCP).

## Стек

- React 19 + Vite 7 + TypeScript, `react-router-dom` 7, `@supabase/supabase-js`, иконки `lucide-react`
- Supabase (проект «AURORA Backend»): Postgres + RLS, pgvector, pg_cron, Storage, Edge Functions
- ИИ — Barabash AI (OpenAI-совместимый шлюз): `qwen3.5:27b` и `nomic-embed-text`

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
```

`.env.local` — адрес проекта и публичный ключ (`.env.example`). `.env.server` — служебные ключи для скриптов, в git не попадает.

## Скрипты

| команда | что делает |
|---|---|
| `npm run db:push` | применяет новые миграции из `supabase/migrations` |
| `npm run fn:deploy [slug…]` | разворачивает edge-функции |
| `npm run setup` | секреты функций, закрытая регистрация, cron `aurora-sync` (каждые 5 минут) |
| `npm run seed` | аккаунт модератора и демо-фирма |
| `npm run smoke` | проверка бэкенда: чат, импорт текста, MCP |
| `npm run e2e` | сквозной сценарий в браузере (нужен `npm run dev`) |
| `npm run shots [desktop\|mobile]` | скриншоты всех экранов в `qc-out/` |

## Edge-функции

- `api` — аккаунты и фирмы, настройки Google OAuth, импорт текста, файлов и сайта, предложения изменений, MCP-ссылки
- `chat` — ответы по базе знаний со ссылками на источники (SSE)
- `sync` — по cron: почта, календарь, очередь сайта, эмбеддинги, утренний дайджест
- `google-callback` — возврат с экрана согласия Google
- `mcp` — MCP-сервер для Claude (Streamable HTTP)

Общий конвейер «текст → факты» — `supabase/functions/_shared/ingest.ts`: приватное отбрасывается, подтверждённое
применяется сразу, спорное и противоречия уходят в «Проверку». Исходный текст писем не сохраняется.

## Роли

- **модератор** — создаёт фирмы, переключается между ними, настраивает Google OAuth
- **администратор** — добавляет людей в свою фирму, решает спорные изменения, ведёт бренд
- **сотрудник** — читает и дополняет базу, подключает свою почту и Claude; аккаунты не создаёт

## Деплой

GitHub Pages через `.github/workflows/deploy.yml`, домен `aurora.fastline.pl` (`public/CNAME`).
Адрес проекта и публичный ключ Supabase зашиты в `src/lib/supabase.ts`; переменные `VITE_SUPABASE_URL` и `VITE_SUPABASE_KEY` нужны, только чтобы собрать сайт под другой проект.

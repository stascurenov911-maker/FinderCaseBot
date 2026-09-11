# Finder Stars Mini App — REAL Telegram version

## Что исправлено

Предыдущий архив падал на `better-sqlite3`, потому что у тебя Node.js 25.9.0 и Windows не нашел готовый native binary, после чего `node-gyp` потребовал Visual Studio C++ + Windows SDK.

Эта версия **не использует better-sqlite3 вообще**. Она использует встроенный `node:sqlite`, который появился в Node 22.5.0 и стал Release Candidate в Node 25.7.0. Поэтому твой Node 25.9.0 подходит. Для production лучше использовать текущую LTS-ветку Node 24.

## Что здесь реально

### 1. Реальная авторизация Telegram Mini App
Сервер принимает `Telegram.WebApp.initData`, проверяет подпись HMAC и только после проверки создает/находит пользователя.

`initDataUnsafe` для авторизации не используется.

### 2. Реальные Telegram Stars
В Mini App есть «Пополнить Stars».

Сервер:
1. создает invoice payload;
2. вызывает `createInvoiceLink`;
3. использует валюту `XTR`;
4. Telegram показывает реальное окно оплаты;
5. сервер получает `pre_checkout_query`;
6. подтверждает его;
7. получает `successful_payment`;
8. проверяет payload и сумму;
9. зачисляет Stars на игровой баланс;
10. сохраняет `telegram_payment_charge_id`.

Это соответствует официальному Telegram Payments API для цифровых товаров/услуг.

### 3. Мины
Случайные мины создаются только сервером.
Ставка списывается сервером.
Результат клетки проверяется сервером.
Клиент не может отправить «я выиграл» и сам начислить себе Stars.

### 4. Апгрейд
Сервер:
- получает исходный NFT;
- рассчитывает шанс;
- генерирует roll;
- фиксирует результат;
- атомарно удаляет исходный internal NFT;
- после анимации подтверждает результат;
- при успехе создает новый NFT в инвентаре.

### 5. Telegram Gifts
В Bot API сейчас есть `getAvailableGifts` и `sendGift`.

В проекте оставлен серверный endpoint для дальнейшей выдачи настоящих Telegram Gifts. Для этого нужно привязать конкретный `telegram_gift_id` к NFT и иметь соответствующий доступ/баланс подарков у бота.

**Важно:** NFT, находящийся во внутреннем игровом инвентаре, не становится автоматически Telegram collectible gift. Это разные уровни владения. Нельзя безопасно сделать вид, что внутренний NFT уже находится у пользователя Telegram.

## Запуск на твоем Node 25.9.0

После распаковки:

```powershell
cd "C:\Users\slava\OneDrive\Рабочий стол\Проекты Пайтон"

Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue

npm install
copy .env.example .env
npm run dev
```

`npm install` больше не должен компилировать `better-sqlite3`.

Проверка:

```powershell
node -v
npm -v
npm run dev
```

Сервер:

`http://localhost:3000`

## Реальный Telegram запуск

Mini App должен быть доступен по HTTPS.

В `.env`:

```env
BOT_TOKEN=токен_от_BotFather
WEBAPP_URL=https://твой-домен.example
WEBHOOK_SECRET=сложная_строка
```

Бот автоматически:
- выставит `/start`;
- добавит кнопку открытия Mini App в меню;
- покажет Web App кнопку в `/start`.

### Важный момент

`WEBAPP_URL` должен быть HTTPS и доступен из интернета.

Для разработки можно использовать HTTPS-туннель.

## Реальные Stars

В Telegram:
1. пользователь открывает Mini App;
2. нажимает «Пополнить Stars»;
3. выбирает сумму;
4. Telegram показывает настоящее окно оплаты;
5. после успешной оплаты backend получает `successful_payment`;
6. Stars появляются во внутреннем балансе Finder.

## Реальные Telegram Gifts

Для production-инвентаря рекомендую хранить:

- `telegram_gift_id`
- `nft_key`
- `rarity`
- `value`
- `status`
- `owner_user_id`

А фонд подарков получать через Bot API `getAvailableGifts`.

При выдаче победителю backend вызывает `sendGift`, а только после успешного ответа Telegram помечает подарок как `delivered`.

Не отправляй Telegram Bot Token в frontend.

## Production

Перед публичным запуском обязательно добавь:
- reverse proxy HTTPS;
- rate limiting;
- резервные копии SQLite;
- admin authentication;
- audit log;
- idempotency для платежей;
- отдельную очередь выдачи подарков;
- лимиты на ставки;
- возрастные/юридические ограничения и проверку законодательства для механик со ставками/случайным результатом.

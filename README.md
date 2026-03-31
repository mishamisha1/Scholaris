# Scholaris

Полноценная демо-структура для деплоя:
- **Backend API** на чистом Node.js HTTP (`server.js`)
- **Frontend** в `public/` (`index.html`, `styles.css`, `app.js`)
- **Файловая БД** в `data/db.json`

## Запуск локально

```bash
npm install
# зависимостей нет, команда безопасна
npm start
```

Сайт будет доступен на `http://localhost:3000`.

## Что работает

- Регистрация / логин пользователей.
- Демо-вход через Google (gmail-проверка, без реального OAuth provider).
- Отправка статьи на модерацию.
- Админ-модерация (логин: `admin`, пароль: `admin123`).
- Публикация после одобрения.
- Поиск, фильтры, сортировка, модальные действия.

## Как запустить на сервере (VPS, Ubuntu)

### 1) Установить Node.js (20+)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

### 2) Залить проект на сервер

Вариант с git:

```bash
git clone <YOUR_REPO_URL> scholaris
cd scholaris
```

Или загрузить архивом и перейти в папку проекта.

### 3) Запустить приложение

```bash
npm install
PORT=3000 npm start
```

Проверка:

```bash
curl http://127.0.0.1:3000/api/health
# ожидается: {"ok":true}
```

### 4) Сделать автозапуск через systemd

Создай файл `/etc/systemd/system/scholaris.service`:

```ini
[Unit]
Description=Scholaris Node App
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/scholaris
Environment=PORT=3000
ExecStart=/usr/bin/node /var/www/scholaris/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Дальше:

```bash
sudo systemctl daemon-reload
sudo systemctl enable scholaris
sudo systemctl start scholaris
sudo systemctl status scholaris
```

### 5) (Опционально) проксирование через Nginx + домен

Пример блока в `/etc/nginx/sites-available/scholaris`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Активировать:

```bash
sudo ln -s /etc/nginx/sites-available/scholaris /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Быстрый деплой на Render / Railway

- Создай новый Web Service из репозитория.
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: `PORT` платформа обычно задаёт сама.

## Важно для production

Сейчас это демо с файловой БД (`data/db.json`).
Для реального продакшена лучше:
- перейти на PostgreSQL/MySQL,
- добавить нормальную авторизацию (JWT / session + secure cookies),
- добавить rate-limit, логирование и бэкапы.


## Как подключить домен (подробно)

### 1) Настрой DNS у регистратора

В панели домена добавь записи:
- `A` запись: `@` → `IP_СЕРВЕРА`
- `A` запись: `www` → `IP_СЕРВЕРА` (опционально)

Проверка:

```bash
dig +short your-domain.com
dig +short www.your-domain.com
```

Обе записи должны возвращать IP твоего сервера.

### 2) Привяжи домен в Nginx

В конфиге сайта (`/etc/nginx/sites-available/scholaris`) укажи домен:

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Применить:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 3) Включи HTTPS (Let's Encrypt)

Установи certbot:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

Выпусти сертификат:

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Проверить автообновление:

```bash
sudo certbot renew --dry-run
```

После этого сайт будет открываться по `https://your-domain.com`.

### 4) Мини-чеклист, если домен не открывается

- `systemctl status scholaris` — приложение запущено?
- `systemctl status nginx` — Nginx работает?
- `ss -tulpen | grep ':80\|:443\|:3000'` — порты слушаются?
- `ufw status` — открыты ли 80/443?
- DNS уже обновился (иногда до 5–30 минут, редко до 24 часов)?
## Деплой

Можно деплоить как обычный Node.js сервис:
- Render / Railway / Fly.io / VPS.
- Команда запуска: `npm start`.
- Порт берётся из `PORT` (fallback `3000`).

> Важно: это демо с файловой БД. Для production лучше заменить `data/db.json` на PostgreSQL/MySQL и добавить нормальную авторизацию (JWT/sessions).

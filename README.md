# Repo

Отдельный standalone-проект для страницы репозитория, включая:

- просмотр репозитория;
- отдельную авторизацию и регистрацию;
- отдельное восстановление пароля;
- отдельную admin-панель репозитория.

## Структура

- `src` — frontend Vite/React
- `backend` — standalone backend Express/PostgreSQL

## Порты по умолчанию

- frontend: `5174`
- backend: `3005`

## Базы данных

- `REPO_AUTH_DB_*` — отдельная БД для авторизации пользователей репозитория
- `REPOSITORY_DB_*` — БД для дерева репозитория и документов

## Первый admin

Автоматическое создание администратора не включено.
После регистрации первого пользователя назначьте ему роль `admin` вручную в таблице `RepositoryUsers`.

## Запуск

### Frontend

1. `npm install`
2. `npm run dev`
3. В dev-режиме запросы `/api` и `/uploads` проксируются на backend (`http://localhost:3005`) через `vite.config.ts`.

### Backend

1. скопируйте `backend/.env.example` в `backend/.env`
2. `npm install`
3. `npm run dev`

## Прод-развёртывание (`nginx` + `pm2`)

1. Соберите frontend: `npm ci && npm run build`
2. Установите backend зависимости: `cd backend && npm ci --omit=dev`
3. Запустите backend через pm2: `pm2 start ecosystem.config.cjs && pm2 save`
4. Подключите nginx-конфиг из `deploy/nginx/repo.conf` (замените домен и путь к проекту)
5. Выпустите сертификат: `certbot --nginx -d <домен> -d www.<домен>`

### Порты в `iptables` (RHEL/CentOS)

1. `iptables -I INPUT -p tcp --dport 22 -j ACCEPT`
2. `iptables -I INPUT -p tcp --dport 80 -j ACCEPT`
3. `iptables -I INPUT -p tcp --dport 443 -j ACCEPT`
4. `iptables -I INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`
5. `iptables -S INPUT`
6. `service iptables save`

Команда `iptables -C ... || iptables -I ...` может печатать `Bad rule` на шаге проверки, если правила ещё нет — это нормальное поведение.

## Каталоги хранения файлов

Чтобы хранить загрузки вне директории проекта, задайте в `backend/.env`:

- `REPOSITORY_UPLOADS_DIR=/var/lib/repo-files`
- `REPOSITORY_XML_DIR=/var/lib/repo-xml`

Если переменные не заданы, используются каталоги внутри `backend/uploads`.

Если сервер выходит в интернет только через SOCKS, для SMTP укажите:

- `SMTP_PROXY=socks5://<host>:<port>`

и установите зависимость в backend: `npm i socks`.

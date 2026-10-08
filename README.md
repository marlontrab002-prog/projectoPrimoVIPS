# 🩸 projectoPrimoVIPS

Admin panel para **DeadpoolCHK** — gestión rápida de usuarios: VIP/FREE, `expiry`, `credits`, `creditsms`, `charged`.

## Qué hace

- **Lista 5K+ usuarios** con paginación (25/50/100/200 por página)
- **Buscar** por `id`, `username`, `email` o `telegramUsername`
- **Filtrar** por estado: Todos / VIP activos / VIP vencidos / Free
- **Filtros avanzados**: rango de `credits` y `creditsms` (min/max)
- **Ordenar** por cualquiera de 8 columnas, asc/desc
- **Editar** campos permitidos con confirmación + diff visual: `isVip`, `expiry`, `credits`, `creditsms`, `charged`
- **Log local** `admin-changes.log` con cada cambio (user, campo, valor viejo → nuevo, timestamp)
- **Auth con password** + sesión cookie firmada (8h, rate-limited: 10 intentos / 15min)
- **Dark / light theme** con persistencia + preferencia OS
- **Responsive** mobile

Paleta visual: rojo DeadpoolCHK + negro, tipografía `Big Shoulders Display` + `Inter` + `JetBrains Mono`.

## Correr local

```bash
cp .env.example .env
# editá .env con las credenciales reales + ADMIN_PASSWORD + SESSION_SECRET
npm install
npm start
# abrí http://localhost:3737
```

## Deploy a Railway

1. **Crear proyecto en Railway** → *Deploy from GitHub repo* → `marlontrab002-prog/projectoPrimoVIPS`
2. Agregar variables de entorno (copiar de `.env.example`, reemplazar con reales)
3. **CRÍTICO**: cambiar `ADMIN_PASSWORD` por algo fuerte antes del primer deploy
4. **CRÍTICO**: `SESSION_SECRET` = `openssl rand -hex 32` (nuevo valor, no el default)
5. Railway detecta Node.js auto. Build: `npm install`, Start: `npm start`
6. Puerto Railway auto-asigna via `PORT`
7. Dominio público — para seguridad adicional, considerar Access en Cloudflare delante

## Endpoints

| Método | Path | Descripción |
|---|---|---|
| GET | `/` | UI (requiere auth) |
| GET | `/login` | Pantalla login |
| POST | `/api/login` | `{ password }` → cookie session |
| POST | `/api/logout` | Cerrar sesión |
| GET | `/api/stats` | Totales + VIPs activos/vencidos/free + sumas |
| GET | `/api/users` | Lista: `?page=1&limit=50&q=&status=&sortBy=&sortDir=&minCredits=&maxCredits=&minSms=&maxSms=` |
| GET | `/api/users/:id` | Detalle de 1 user |
| PATCH | `/api/users/:id` | Actualizar `{ isVip?, expiry?, credits?, creditsms?, charged? }` (whitelist estricta) |
| GET | `/healthz` | Health check (sin auth) |

## Seguridad

- Rate limit login: 10/15min
- Rate limit API: 300/min
- Whitelist estricta de campos editables en `PATCH`
- Validación de tipos antes del UPDATE
- Prepared statements (no SQL injection posible)
- Cookies `httpOnly + signed + sameSite=strict + secure` (en HTTPS)
- Sesión en memoria (se resetea en redeploy — considerá Redis si lo necesitás persistente)

## Shortcuts teclado

- `/` → focus en search
- `Esc` → cerrar modal de edición

## Rollback / recovery

Backup histórico en la BD: tabla `users_backup_20260907193129` (401 rows) para referencia.
Si algo se rompe por un UPDATE accidental, siempre podés recuperar valores de ahí con un `JOIN` por `id`.

## Stack

- Node.js ≥18, Express, mysql2/promise
- `express-rate-limit`, `cookie-parser`, `bcryptjs` (reservado para hash futuro), `dotenv`
- Frontend: HTML + CSS + JS vanilla (sin framework)

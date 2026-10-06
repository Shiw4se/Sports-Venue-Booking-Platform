# SportBook — Sports Venue Booking Platform

[![CI](https://github.com/Shiw4se/Sports-Venue-Booking-Platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Shiw4se/Sports-Venue-Booking-Platform/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169E1?logo=postgresql&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-4-FF6600?logo=rabbitmq&logoColor=white)

A full-stack, event-driven microservice platform for booking football fields, tennis and basketball courts.
Players browse venues with photos and reviews, book a time slot, pay with Stripe Checkout, get email confirmations
and reminders, and rate the games they played; admins manage venues, galleries and recurring schedules and track revenue on a dashboard.

![Venues](docs/screenshots/venues.png)

| Venue page: photos, availability, reviews | Booking a slot |
|---|---|
| ![Venue page](docs/screenshots/venue-page-full.png) | ![Booking](docs/screenshots/booking.png) |

| Player profile | Admin dashboard |
|---|---|
| ![Profile](docs/screenshots/profile.png) | ![Dashboard](docs/screenshots/dashboard.png) |

| Emails (dev mailbox) | Recurring slots |
|---|---|
| ![Emails](docs/screenshots/mailbox.png) | ![Slot schedule](docs/screenshots/slot-schedule.png) |

![Awaiting payment](docs/screenshots/awaiting-payment.png)

## Features

**For players**
- Browse venues with type filters, search and a "Saved" filter; cards show a photo, rating, price, indoor/outdoor, capacity, surface and amenities
- Venue page: photo gallery, description, key facts, amenities, availability for the next 7 days, how busy the week is,
  quick-book buttons for the next free times, a link to the map and reviews with a star distribution
- Save venues with ♥ and find them in the profile
- Rate played games (1–5 stars + comment); only players who actually played can review
- Emails: welcome, booking confirmation, cancellation, a reminder the day before the game, password reset
- "Forgot password?" flow with a one-time, 1-hour reset link
- Pick a time slot grouped by day and see the total price before booking
- Pay online with Stripe Checkout: the slot is held for 30 minutes while you pay, unpaid holds are released
  automatically, "Pay now" from the profile, full refund when a paid booking is cancelled
- Profile with the next game (countdown, add to calendar, directions), stats, a 12-week activity heatmap and achievements
- Bookings with upcoming / history tabs, one-click cancellation and "Book again"
- Edit name, password and avatar: upload a photo (cropped and resized to 256×256 WebP in the browser) or pick a color
- Responsive layout, light & dark theme, toast notifications, keyboard-friendly modals

**For admins**
- Create, edit and delete venues (type, address, price, surface, indoor/outdoor, capacity, amenities, description)
- Upload a photo gallery per venue (resized in the browser; the first photo becomes the cover)
- Manage each venue's schedule: single slots or recurring ones ("Mon–Fri, 18:00–22:00, 1-hour slots, for 4 weeks"),
  overlaps are skipped automatically
- Dev mailbox: every email the platform sent, rendered as the recipient sees it
- Dashboard: revenue, active / upcoming / cancelled bookings, bookings for the next 7 days, top venues

**Under the hood**
- **No double booking** — a slot is reserved with a single atomic `UPDATE … WHERE is_available`;
  of two concurrent requests exactly one wins, the other gets `409`. A partial unique index backs it up in the database.
- **Saga-style compensation** — if creating the booking fails after the slot was reserved, the slot is released.
- **Price snapshot** — the booking stores the price at booking time, so later price changes don't rewrite history.
- **Payments done safely** — a dedicated payment service owns the Stripe keys. A booking is confirmed exactly once whether the
  webhook or the player's return to the site arrives first (idempotent `mark_paid`, webhook events deduplicated by id).
  A payment that lands after the hold expired is refunded automatically; cancelling a paid booking refunds first and
  cancels only if the refund succeeded. Without `STRIPE_SECRET_KEY` bookings are confirmed instantly (useful in CI).
- **Event-driven notifications** — services publish domain events (`booking.created`, `booking.cancelled`, `booking.expired`,
  `booking.reminder`, `payment.refunded`, `user.registered`, `user.password_reset_requested`, `venue.rating_changed`) to a durable RabbitMQ topic exchange;
  the notification service and the venue service react to them without the publishers knowing about them.
- **Pluggable email delivery** — SMTP (Resend, SendGrid, Mailtrap, …) via `SMTP_URL`; without it emails are kept in a dev mailbox.
- **Safe password reset** — only a SHA-256 hash of the emailed token is stored; the token expires in an hour and works once;
  "forgot password" never reveals whether an email is registered.
- **Security** — JWT with expiry, bcrypt password hashing, ownership checks on every booking route,
  role-based admin routes, rate limiting on login/registration, Helmet security headers, input validation.
- **Resilient messaging** — one RPC client per service using RabbitMQ direct reply-to, request timeouts (`504` instead of hanging),
  automatic reconnect on startup, handlers that never crash the consumer.
- **Observability** — `GET /api/health` pings every microservice through the broker.
- **API docs** — interactive Swagger UI at `/api/docs`.
- **Tests & CI** — frontend unit tests (profile stats, schedule expansion, avatar) and an 84-check end-to-end suite against a real
  PostgreSQL + RabbitMQ (incl. emails, reminders, reviews, photos), run on every push by GitHub Actions.

## Architecture

```mermaid
flowchart LR
    Browser["React SPA"] -->|HTTP /api| GW["API Gateway<br/>Express · JWT · rate limit · Swagger"]
    GW <-->|RPC| MQ[("RabbitMQ<br/>RPC queues +<br/>events exchange")]
    MQ <--> US["User service<br/>auth, profiles, avatars,<br/>favorites, password reset"]
    MQ <--> VS["Venue service<br/>venues, slots, photos,<br/>atomic reservation"]
    MQ <--> BS["Booking service<br/>bookings, pricing, reviews,<br/>stats, reminder scheduler"]
    MQ --> NS["Notification service<br/>email templates,<br/>SMTP / dev mailbox"]
    MQ <--> PS["Payment service<br/>Stripe Checkout,<br/>webhooks, refunds"]
    PS <--> Stripe[("Stripe")]
    Stripe -.->|webhook| GW
    US --> DB[("PostgreSQL")]
    VS --> DB
    BS --> DB
    NS --> DB
    PS --> DB
```

Services talk to each other only through RabbitMQ:

- **RPC** (request/reply over `amq.rabbitmq.reply-to`) when an answer is needed — e.g.
  `gateway → booking-service → venue-service (reserve slot atomically) → booking-service (save booking, or release slot on failure)`.
- **Events** (durable topic exchange `sportbook.events`) for things others may react to — e.g. booking-service publishes
  `booking.created`; notification-service looks up the player and venue and sends the confirmation email.
  A new review publishes `venue.rating_changed`, which venue-service uses to keep the rating shown on cards.

Booking a paid slot: `gateway → booking-service (reserve slot, booking `pending_payment`) → payment-service (Stripe Checkout Session)
→ player pays on Stripe → webhook or `GET /api/payments/verify` → payment-service → booking-service `mark_paid` → `booked``.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 (Create React App), CSS Modules, date-fns |
| API Gateway | Node.js, Express, JWT, Helmet, express-rate-limit, Swagger UI |
| Services | Node.js, Sequelize ORM, bcrypt |
| Messaging | RabbitMQ (AMQP 0-9-1, RPC) |
| Database | PostgreSQL |
| Tooling | GitHub Actions, Docker Compose, end-to-end test suite |

## Quick start

Requirements: Node.js 20+.

```bash
git clone https://github.com/Shiw4se/Sports-Venue-Booking-Platform.git
cd Sports-Venue-Booking-Platform
npm install
npm run install:all
```

**1. Start PostgreSQL and RabbitMQ** — pick one option:

| Option | Commands |
|---|---|
| Docker | `npm run infra:up` (schema is applied automatically) |
| No Docker, no admin rights (Windows) | `npm run db:local` and `npm run mq:local` — each in its own terminal |
| Your own installation | create database `SportCourts`, then `psql -d SportCourts -f backend/db/init.sql` |

`db:local` runs a portable PostgreSQL from the `embedded-postgres` npm package (data in `.pgdata/`).
`mq:local` downloads portable Erlang/OTP and RabbitMQ into `%USERPROFILE%\devtools` on first run.

**2. Configure services** — copy `.env.example` to `.env` in each of `backend/api-gateway`,
`backend/user-service`, `backend/venue-service`, `backend/booking-service`, `backend/notification-service`.
The defaults work with all options above; set `SMTP_URL` in notification-service to deliver real emails. `JWT_SECRET` must be the same in `api-gateway` and `user-service`.

**3. Load demo data (optional)**

```bash
npm run seed            # empty database only
npm run seed -- --reset # wipe demo data and reseed (refuses if real accounts exist;
                        # add --include-real-users to delete them too)
```

| Role | Email | Password |
|---|---|---|
| Admin | `admin@sportbook.dev` | `admin1234` |
| Player | `demo@sportbook.dev` | `demo1234` |

**4. Run**

```bash
npm start
```

- App: http://localhost:3010
- API docs: http://localhost:3000/api/docs
- Health: http://localhost:3000/api/health
- RabbitMQ UI (local/Docker): http://localhost:15672 (guest / guest)

To make any registered user an admin: `UPDATE users SET role = 'admin' WHERE email = '…';` and log in again.

## Testing

```bash
npm run test:e2e                         # against the running stack (default http://localhost:3000/api)
npm run test:payments                    # payment pipeline against stripe-mock (see below)
E2E_API_URL=http://host:port/api npm run test:e2e
cd frontend && npm test                  # frontend unit tests
```

**Payments without a Stripe account.** [stripe-mock](https://github.com/stripe/stripe-mock) is Stripe's official API emulator.
Run it (`stripe-mock -http-port 12111`), start payment-service with
`STRIPE_SECRET_KEY=sk_test_123 STRIPE_WEBHOOK_SECRET=whsec_test STRIPE_API_BASE=http://localhost:12111`, and `npm run test:payments`
exercises the whole pipeline: Checkout Session, held slot, locally signed webhooks (signature verification is the real thing),
duplicate events, refund on cancel, hold expiry, a payment that lands after expiry (auto-refund), "Pay now", admin and free slots.
CI does exactly this. The same variables make `npm run test:e2e` run its Stripe branch too.

**Real Stripe (test mode).** Needs an account in a [country Stripe supports](https://stripe.com/global). To see a real payment, install the Stripe CLI (`npm install -g @stripe/cli`), run
`stripe listen --forward-to localhost:3000/api/payments/webhook`, put the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`,
restart the payment service and pay with the test card `4242 4242 4242 4242`.

The end-to-end suite covers registration and login, role checks, venue and slot validation,
concurrent booking of the same slot, pricing, ownership checks, cancellation, admin stats,
time-zone round-trips and error handling. It creates its own data and removes it afterwards.

## API

Full interactive reference: **`/api/docs`** (OpenAPI 3 spec at `/api/openapi.json`).

![Swagger UI](docs/screenshots/api-docs.png)
🔒 = `Authorization: Bearer <token>`, 👑 = admin only.

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Status of the gateway and every service |
| POST | `/api/user/register` | Register (`name`, `email`, `password` ≥ 6 chars) |
| POST | `/api/user/login` | Log in, returns `{ token }` |
| GET | `/api/user/profile` 🔒 | Current user |
| PUT | `/api/user/profile` 🔒 | Update name / avatar color |
| PUT | `/api/user/password` 🔒 | Change password (`currentPassword`, `newPassword`) |
| PUT | `/api/user/avatar` 🔒 | Upload a photo (`dataUrl`: PNG / JPEG / WebP, ≤ 300 KB) |
| DELETE | `/api/user/avatar` 🔒 | Remove the photo |
| GET | `/api/user/avatar/:id` | Avatar image (versioned URLs are cached for a year) |
| GET | `/api/venue/get_all` | List venues |
| GET | `/api/venue/find_by_id/:id` | Slots of a venue |
| POST | `/api/venue/create` 👑 | Create a venue |
| PUT | `/api/venue/update/:id` 👑 | Update a venue |
| DELETE | `/api/venue/delete/:id` 👑 | Delete a venue |
| POST | `/api/venue/createslot/:venueId` 👑 | Create a slot (`start_time`, `end_time`) |
| DELETE | `/api/venue/deleteslot/:id` 👑 | Delete a slot |
| POST | `/api/bookings/create` 🔒 | Book a slot (`slot_id`); returns `checkout_url` when payment is required |
| POST | `/api/bookings/:bookingId/pay` 🔒 | New Checkout Session for a booking awaiting payment |
| GET | `/api/payments/verify?session_id=` 🔒 | Confirm a Checkout Session after returning from Stripe |
| POST | `/api/payments/webhook` | Stripe webhook (signature-verified) |
| GET | `/api/bookings/:userId` 🔒 | Own bookings |
| DELETE | `/api/bookings/:bookingId` 🔒 | Cancel an own booking |
| GET | `/api/admin/stats` 👑 | Dashboard statistics |
| POST | `/api/user/password/forgot` | Email a password reset link (`email`) |
| POST | `/api/user/password/reset` | Set a new password (`token`, `newPassword`) |
| GET | `/api/user/favorites` 🔒 | Saved venue ids |
| PUT / DELETE | `/api/user/favorites/:venueId` 🔒 | Save / unsave a venue |
| GET | `/api/venue/:id/reviews` | Rating summary, distribution and latest reviews |
| POST | `/api/bookings/:bookingId/review` 🔒 | Rate a played game (`rating` 1–5, `comment`) |
| POST | `/api/venue/createslots/:venueId` 👑 | Create many slots (`slots: [{ start_time, end_time }]`), overlaps skipped |
| POST | `/api/venue/:id/photos` 👑 | Upload a gallery photo (`dataUrl`, ≤ 900 KB, up to 8 per venue) |
| DELETE | `/api/venue/photos/:photoId` 👑 | Delete a photo |
| GET | `/api/venue/photos/:photoId` | Photo image |
| GET | `/api/admin/emails`, `/api/admin/emails/:id` 👑 | Dev mailbox |

## Project structure

```
backend/
  api-gateway/      HTTP API (:3000): auth, rate limiting, Swagger, health, RPC to services
  user-service/     registration, login, user validation
  venue-service/    venues and slots, atomic slot reservation
  booking-service/  bookings, pricing, reviews, admin statistics, day-before reminder scheduler
  notification-service/ email templates; sends via SMTP or keeps emails in the dev mailbox
  payment-service/  Stripe Checkout sessions, webhook handling, refunds
  shared/           RPC client/server and RabbitMQ connection helpers
  db/               schema (init.sql), demo seed, portable PostgreSQL launcher
  mq/               portable RabbitMQ launcher (Windows)
  tests/            end-to-end test suite
frontend/           React app (dev server :3010, proxies /api to :3000)
docs/screenshots/   images used in this README
.github/workflows/  CI pipeline
```

## Configuration

| Variable | Service | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | user, venue, booking | `postgres://postgres:postgres@localhost:5432/SportCourts` | PostgreSQL connection |
| `RABBITMQ_URL` | all | `amqp://localhost` | RabbitMQ connection |
| `RPC_QUEUE` | user, venue, booking | `<service>_rpc_queue` | Queue the service listens on |
| `JWT_SECRET` | gateway, user | — | Secret for signing tokens (must match) |
| `JWT_EXPIRES_IN` | user | `1d` | Token lifetime |
| `PORT` | gateway | `3000` | HTTP port |
| `RPC_TIMEOUT_MS` | gateway | `10000` | Timeout for a service reply |
| `AUTH_RATE_LIMIT` | gateway | `50` | Login/register/password-reset attempts per IP per 15 minutes |
| `SMTP_URL` | notification | empty | e.g. `smtps://resend:API_KEY@smtp.resend.com:465`; empty = dev mailbox only |
| `MAIL_FROM` | notification | `SportBook <no-reply@sportbook.dev>` | Sender address |
| `APP_URL` | notification | `http://localhost:3010` | Base URL for links in emails |
| `APP_TIMEZONE` | notification | `Europe/Kyiv` | Time zone of dates in emails |
| `REMINDER_INTERVAL_MS` | booking | `300000` | How often to look for games starting within 24 hours |
| `PAYMENT_HOLD_MINUTES` | booking, payment | `30` | How long a slot is held while the player pays (Stripe minimum) |
| `PAYMENT_SWEEP_INTERVAL_MS` | booking | `60000` | How often expired holds are released |
| `STRIPE_SECRET_KEY` | payment | empty | `sk_test_…` / `sk_live_…`; empty = payments disabled |
| `STRIPE_WEBHOOK_SECRET` | payment | empty | `whsec_…` from the Stripe CLI or Dashboard |
| `STRIPE_CURRENCY` | payment | `usd` | Checkout currency |
| `APP_URL` | payment | `http://localhost:3010` | Where Stripe sends the player back |

## Roadmap

- E-mail verification on sign-up
- Containerised services and one-command cloud deployment

## Contact

Telegram: [@shiw4se](https://t.me/shiw4se) · E-mail: [ausenko476@gmail.com](mailto:ausenko476@gmail.com)

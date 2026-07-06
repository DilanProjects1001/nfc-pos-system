# nfc-pos-system

**End-to-end NFC payment terminal and closed-loop virtual currency, built for a real venue.**

![Stack](https://img.shields.io/badge/Node.js-Express_5-339933?logo=node.js&logoColor=white)
![DB](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
![Realtime](https://img.shields.io/badge/Realtime-WebSocket-FF6600)
![Hardware](https://img.shields.io/badge/Hardware-Proxmark3_NFC-8A2BE2)
![Auth](https://img.shields.io/badge/Auth-JWT_%2B_bcrypt-000000?logo=jsonwebtokens&logoColor=white)
![License](https://img.shields.io/badge/License-All_Rights_Reserved-red)
![Status](https://img.shields.io/badge/status-portfolio_showcase-blue)

A members club needed to stop handling cash at every counter. This system replaces it with a closed-loop virtual currency ("Cacaos"): members tap a physical NFC card, the operator charges their balance, and every movement is logged in an auditable transaction ledger. It was built and deployed for a **real business**, anonymized here as **"Club Demo"**.

<!-- DEMO
TODO (Dilan): capture two assets and drop them here.
  1) docs/pos-checkout.png  — screenshot of the POS terminal (public/pos) mid-checkout:
     product grid on the left, cart on the right, the NFC-scan member panel open
     showing a resolved member name + balance. Run `npm start`, open /pos, log in
     as a vendor, add a few seeded products to the cart, then open checkout.
  2) docs/nfc-charge.gif  — ~6s screen recording of a live charge: card tapped on the
     Proxmark3 -> UID auto-fills the checkout field -> member resolves -> balance drops.
     If the reader isn't handy, run the daemon in emulator mode (see below) and type a
     seeded UID like NFC-SIM-0001 to fire the same WebSocket event for the GIF.

![POS terminal](docs/pos-checkout.png)
![Live NFC charge](docs/nfc-charge.gif)
-->

---

## Key Features

- **Hardware -> web bridge in real time.** A standalone daemon (`nfc-daemon.js`) drives a **Proxmark3** over its serial console, polls for ISO 14443-A cards every **1.5s** (`hf 14a reader`), parses the UID out of the console output with a regex, normalizes it, and pushes it to the POS over a **WebSocket** (port `3001`). The cashier never types a card number — tapping a card auto-fills the checkout and resolves the member instantly. Ships with an **emulator mode** (type a UID into the console) so the full flow can be demoed with no reader attached.
- **Transactional integrity, by design.** Every balance change runs inside a `better-sqlite3` transaction and the schema enforces the invariants at the database level:
  - **Anti-double-charge lock** — a `transaction_locks` table with a `UNIQUE` card UID acts as a mutex; a second tap on the same card within a configurable window (default **5s**) is rejected with `429` instead of charging twice.
  - **Idempotent refunds** — a refund records `refund_of = <original_tx_id>`; a second refund attempt on the same purchase is detected and blocked, so a transaction can never be refunded twice.
  - **`balance >= 0` enforced in SQL** — a `CHECK(balance >= 0)` constraint plus an explicit pre-check make an overdraft structurally impossible.
  - **Immutable ledger** — every transaction stores `balance_before` and `balance_after`, so the full money trail is auditable and reconstructable.
- **Two role-aware web UIs** (vanilla JS, no build step): an **admin panel** (`/admin`) for members, recharges, refunds, cashouts, products, terminals and reporting; and a **POS terminal** (`/pos`) for vendors to ring up sales.
- **JWT auth with role separation.** `admin` vs `vendor` roles gate every route (`requireAuth` / `requireAdmin` / `requireOperator`); passwords are hashed with **bcrypt**. The server **refuses to boot** if `JWT_SECRET` is unset (deny-by-default).
- **Operational hardening.** Automatic SQLite backups every 24h (last 7 retained), a background **terminal auditor** that flags POS terminals offline after a 60s heartbeat gap, WAL mode + enforced foreign keys, and `helmet` security headers.

## Architecture

```
 ┌───────────────┐    serial     ┌──────────────────┐    WebSocket    ┌──────────────┐
 │  Proxmark3     │ ───────────▶ │   nfc-daemon.js   │ ─────:3001────▶ │  POS (/pos)   │
 │  + Iceman fw   │   UID console │ (UID parse+debounce)│  NFC_SCAN event │  browser     │
 └───────────────┘               └──────────────────┘                 └──────┬───────┘
                                                                              │ REST + JWT
                                                                              ▼
                          ┌────────────────────────────────────────────────────────────┐
                          │  Express API  (:3000)                                        │
                          │  auth · members · cards · products · terminals · transactions│
                          │  ── transaction engine: lock → tx → ledger ──                │
                          └───────────────────────────────┬────────────────────────────┘
                                                          ▼
                                       ┌────────────────────────────────┐
                                       │  SQLite (better-sqlite3, WAL)   │
                                       │  CHECK(balance>=0) · FK on       │
                                       └────────────────────────────────┘
 Admin panel (/admin) ── REST + JWT ──▶ Express API
```

The daemon is intentionally decoupled from the API: it knows nothing about balances or auth, it only translates hardware taps into `NFC_SCAN` WebSocket events. The browser holds the JWT and talks to the REST API for everything money-related.

## Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js, Express 5 |
| Database | SQLite via `better-sqlite3` (WAL, FK enforced) |
| Realtime | `ws` (WebSocket) |
| Auth | `jsonwebtoken` (JWT), `bcryptjs` |
| Hardening | `helmet`, `cors`, `morgan` |
| Hardware | Proxmark3 (Iceman client), serial console driven via `child_process` |
| Frontend | Vanilla HTML/CSS/JS (admin + POS), no build step |

## Getting Started

> Requires Node.js 18+. The NFC reader is **optional** — the daemon has an emulator mode so the whole flow runs without hardware.

```bash
# 1. Install dependencies
npm install

# 2. Create your env file and set a JWT secret (server won't boot without it)
cp .env.example .env        # then edit .env -> set JWT_SECRET

# 3. Start the API + web UIs. The SQLite DB is created and seeded
#    with DEMO data automatically on first run.
npm start
```

Then open:
- Admin panel — http://localhost:3000/admin
- POS terminal — http://localhost:3000/pos

To bridge a real reader (or emulate one), run the daemon separately:

```bash
# with a Proxmark3 on COM3 (proxmark3 must be on PATH):
node nfc-daemon.js COM3

# no reader? emulator mode — type a seeded UID (e.g. NFC-SIM-0001) + Enter
# to fire the same NFC_SCAN event the POS receives:
node nfc-daemon.js
```

### Demo credentials

The database seeds **demonstration accounts only** — these are sample data for evaluating the app, not real credentials:

| Role | User | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Vendor | `carlos` | `vendor123` |

It also seeds demo members (`CAC-0001` …), demo terminals, products and simulated NFC cards (`NFC-SIM-0001` …) so the POS is usable immediately.

> **What is *not* in this repo:** the production database — real member balances, names, phones and card UIDs (PII) — is gitignored and excluded. Only the demo seed ships. This is a portfolio copy; the secrets live only in a local `.env`.

## Engineering decisions / What I learned

- **Push the invariants into the database.** Rather than trusting application code to never overdraft or double-refund, the rules live as SQL `CHECK` constraints, a `UNIQUE`-backed lock, and a `refund_of` self-reference. The DB is the last line of defense even if a future route forgets a guard.
- **Decouple the hardware.** The Proxmark3 has no SDK for this use case, so the daemon scrapes its console and debounces repeat reads (a card sitting on the antenna would otherwise fire dozens of charges). Keeping that messy translation isolated from the API kept the business logic clean and testable.
- **Build for the room it runs in.** Auto-backups, an offline-terminal auditor, and WAL mode came from the reality of running on club hardware over a flaky local network during a live event — not from a spec.

## License

All Rights Reserved — © 2026 Dilan del Valle Mijangos. This code is published **solely for portfolio review and technical evaluation**. It may not be copied, reused, or redistributed without written permission. See [`LICENSE`](LICENSE).

Contact: dilandelvallemijangos@gmail.com · 951 128 8667

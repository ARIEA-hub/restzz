<div align="center">

# 🍴 Q-Sense OS
### Restaurant Queue & Reservation Intelligence Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-v5.2-000000?logo=express)](https://expressjs.com)
[![FastAPI](https://img.shields.io/badge/FastAPI-v0.135-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://python.org)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com)
[![scikit-learn](https://img.shields.io/badge/ML-scikit--learn-F7931E?logo=scikit-learn&logoColor=white)](https://scikit-learn.org)

*Smart waitlist management, live table allocation, real-time queue tracking,  
and ML-powered wait-time prediction — for restaurants and their guests.*

</div>

---

## ⚠️ SECURITY & DISCLOSURE NOTICES

> **Read this section before cloning, forking, or deploying this repository.**

### 🔴 Credential Exposure (Resolved — Action Required Before Deploy)

A previous version of this repository contained the following secrets committed directly to source control inside `.env`. These values have been **identified and must be rotated immediately** if you have cloned any prior version:

| Secret | Status | Required Action |
|--------|--------|----------------|
| `DB_PASSWORD=N3El@12E4` | MySQL root password (local) | Rotate your MySQL root password |
| `JWT_SECRET=supersecretkey` | Weak, guessable value | Replace with 64-char cryptographic random string |
| `EMAIL_USER=pandeyneelansh2@gmail.com` | Gmail address hardcoded | Move to `.env` (already done in this version) |
| `EMAIL_PASS=kciu xwie psnv ubvi` | Gmail App Password hardcoded | Revoke this App Password in Google Account settings and generate a new one |
| `DB_USER=root` | MySQL root account used | Replace with a scoped application user with least-privilege access |

**The current version of this codebase has removed all hardcoded secrets.** All values are loaded from `.env`. The `.env` file itself is listed in `.gitignore` and must never be committed.

### 🟡 Database Migration Status

This project has been migrated from **local MySQL** to **Supabase PostgreSQL**. If you are running an older checkout that still uses `mysql2`, follow the [Database Setup](#step-3--database-setup-supabase) section below.

### 🟡 Location Data & User Privacy

This application collects and stores **GPS latitude/longitude coordinates** for logged-in customers via the browser's Geolocation API (`navigator.geolocation.watchPosition`). If you deploy this application publicly or commercially, you are required to:

- Display a clear cookie/location consent banner before activating tracking
- Include a Privacy Policy disclosing what location data is collected, how long it is retained, and how it is used
- Comply with applicable privacy regulations (GDPR, DPDP Act 2023 for India, CCPA, etc.)
- Provide users the ability to opt out and request data deletion

Location tracking in the current codebase activates automatically on the Locations page when a user is logged in. This must be gated behind explicit user consent for production deployments.

### 🟡 ML Model Disclaimer

The wait-time prediction model (`models/wait_time_model.pkl`) is a **Linear Regression** trained on a small synthetic dataset (`data/raw/restaurant_wait_times.csv`, 4 features, limited rows). It is included for demonstration and development purposes only. Predictions should not be presented to end users as guaranteed or accurate without retraining on real operational data from your own restaurant.

### 🟡 Gmail SMTP Dependency

OTP emails are delivered via Google's Gmail SMTP using an App Password. This is subject to Google's terms of service and may be rate-limited or revoked. For production use, replace with a dedicated transactional email provider (SendGrid, AWS SES, Resend, or Postmark).

### 🟢 Authentication Architecture (Current State)

OTP verification has been **moved to the Registration phase only** (not Login). Users must verify their email once when creating their account. Subsequent logins use standard `bcrypt` password comparison and return a signed JWT. There is no OTP during the login flow.

---

## 📋 Table of Contents

1. [What Q-Sense Does](#-what-q-sense-does)
2. [Architecture Overview](#-architecture-overview)
3. [Project Structure](#-project-structure)
4. [Tech Stack](#-tech-stack)
5. [Prerequisites](#-prerequisites)
6. [Installation & Setup](#-installation--setup)
   - [Step 1 — Clone & Environment](#step-1--clone--environment)
   - [Step 2 — Node.js Backend Setup](#step-2--nodejs-backend-setup)
   - [Step 3 — Database Setup (Supabase)](#step-3--database-setup-supabase)
   - [Step 4 — Python / ML Setup](#step-4--python--ml-setup)
   - [Step 5 — Email (OTP) Configuration](#step-5--email-otp-configuration)
   - [Step 6 — Train the ML Model](#step-6--train-the-ml-model)
7. [Running the Application](#-running-the-application)
8. [API Reference](#-api-reference)
9. [Frontend Pages](#-frontend-pages)
10. [Testing](#-testing)
11. [Environment Variables Reference](#-environment-variables-reference)
12. [Common Errors & Fixes](#-common-errors--fixes)
13. [Contributing](#-contributing)
14. [License](#-license)

---

## 🎯 What Q-Sense Does

Q-Sense is a full-stack restaurant operating system with two integrated server layers:

**For Customers**
- Create an account with email OTP verification
- Browse restaurant locations on a live Leaflet map with real-time GPS positioning
- Join a virtual queue and track your position and estimated wait time in real time
- Book advance reservations and receive table confirmation emails automatically

**For Restaurant Staff & Managers**
- Live admin dashboard showing all pending reservations and queue entries
- One-click table allocation that triggers a confirmation email to the customer
- Table status management (vacant / occupied / reserved / unavailable)
- Role-based access (staff, manager, owner)

**ML Prediction Layer**
- FastAPI server runs a scikit-learn Linear Regression model
- Predicts wait time in minutes given party size, current queue length, and available tables
- Exposed at `GET /api/predict` for integration with any frontend or third-party system

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         BROWSER                              │
│   frontend/  (HTML + CSS + Vanilla JS + Leaflet Maps)       │
└───────────────────────┬────────────────────────────┬────────┘
                        │ REST (port 5000)            │ REST (port 8000)
                        ▼                             ▼
┌──────────────────────────────┐    ┌────────────────────────────┐
│  Express.js API Server        │    │  FastAPI ML Server          │
│  api/server.js                │    │  api/main.py                │
│                               │    │                             │
│  Routes:                      │    │  Routes:                    │
│  /api/users    (auth + JWT)   │    │  /api/predict  (wait time)  │
│  /api/admin    (auth + JWT)   │    │  /api/restaurants (from DB) │
│  /api/restaurant              │    │  /api/reservations          │
│  /api/tables                  │    │  /api/queue                 │
│  /api/reservations            │    │                             │
│  /api/queue                   │    │  ML Model:                  │
│  /api/location  (GPS)         │    │  LinearRegression (sklearn)  │
│  /api/send-otp                │    │  models/wait_time_model.pkl │
│  /api/verify-otp              │    └──────────────┬─────────────┘
└──────────────┬───────────────┘                   │
               │                                   │
               └──────────────┬────────────────────┘
                              │ SQLAlchemy / pg (PostgreSQL)
                              ▼
┌──────────────────────────────────────────────────┐
│              Supabase PostgreSQL                  │
│                                                   │
│  Tables:                                          │
│  customer · admin · restaurant · restaurant_tables│
│  reservation · queue                              │
└──────────────────────────────────────────────────┘
         ▲
         │ Gmail SMTP (nodemailer)
┌────────┴─────────┐
│  OTP Emails       │
│  Confirmation     │
│  Emails           │
└──────────────────┘
```

---

## 📁 Project Structure

```
qsense/
│
│   .env                          ← Secret credentials (NEVER commit)
│   .gitignore
│   LICENSE
│   package.json                  ← Node.js manifest (npm install from here)
│   README.md
│   requirements.txt              ← Python dependencies (pip install from here)
│
├───api/                          ← Server-side code (both JS and Python)
│   │   server.js                 ← Express.js entry point (port 5000)
│   │   database.js               ← PostgreSQL connection pool (pg / Supabase)
│   │   main.py                   ← FastAPI entry point (port 8000)
│   │   database.py               ← SQLAlchemy engine (Supabase)
│   │   models.py                 ← SQLAlchemy ORM models
│   │   schemas.py                ← Pydantic request/response schemas
│   │
│   └───routes/
│           users.js              ← Customer registration + login (JWT)
│           admin.js              ← Admin registration + login + dashboard ops
│           restaurant.js         ← Restaurant listing (Express)
│           tables.js             ← Table status management
│           reservations.js       ← Booking create/read/cancel
│           queue.js              ← Join queue, check position, admin controls
│           otp.js                ← Send OTP email + verify OTP (registration only)
│           location.js           ← GPS coordinate update + nearby restaurant finder
│           restaurants.py        ← FastAPI restaurant route (reads from Supabase)
│           prediction.py         ← FastAPI ML prediction route
│           reservations.py       ← FastAPI reservations stub
│           queue.py              ← FastAPI queue stub
│
├───frontend/                     ← All HTML pages, CSS, images, videos
│   │   index.html                ← Landing page
│   │   CustomerSignUp.html       ← Customer registration (triggers OTP)
│   │   CustomerLogin.html        ← Customer login (JWT, no OTP)
│   │   CustomerDashboard.html    ← Logged-in customer home
│   │   CustomerReservation.html  ← Book a table
│   │   CustomerHome.html         ← Customer browse page
│   │   JoinQueue.html            ← Join & track live queue
│   │   AdminLogin.html           ← Admin login (JWT, no OTP)
│   │   AdminSignUp.html          ← Admin registration (triggers OTP)
│   │   AdminDashboard.html       ← Admin command center
│   │   AdminTableManagement.html ← Table status management UI
│   │   OtpVerification.html      ← Email OTP entry (registration only)
│   │   locations.html            ← Leaflet map + restaurant list + GPS tracking
│   │   style.css                 ← Shared stylesheet
│   │   dynamic-features.css      ← Animation and interactive styles
│   │
│   └───js/
│           api.js                ← Shared API base URL + fetch helpers + JWT util
│           locations.js          ← Leaflet map init + restaurant pins + watchPosition
│           reservation.js        ← Reservation form handler
│
├───data/
│   └───raw/
│           restaurant_wait_times.csv   ← Training data for ML model
│
├───models/
│       wait_time_model.pkl       ← Trained scikit-learn model (generated by train_model.py)
│
├───scripts/
│       init_db.py                ← Creates all Supabase tables + seed data
│
├───src/                          ← Python ML pipeline source
│   ├───data/
│   │       data_loader.py        ← CSV ingestion
│   │       preprocessing.py      ← Feature cleaning
│   ├───features/
│   │       feature_engineering.py ← Feature construction
│   ├───models/
│   │       train_model.py        ← Train + save wait_time_model.pkl
│   │       predict_model.py      ← Load model + expose predict_wait_time()
│   │       evaluate_model.py     ← Model evaluation metrics
│   └───utils/
│           config.py             ← Centralised paths + env loading
│
├───docs/
│       architecture.md           ← Architecture notes
│
└───tests/
        test_prediction.py        ← pytest suite for ML model + FastAPI endpoint
```

---

## 🔧 Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Frontend | HTML5 + CSS3 + Vanilla JS | — | All UI pages |
| Maps | Leaflet.js | 1.9.4 | Restaurant map + user GPS marker |
| Backend API | Express.js | 5.2.1 | Main REST API server |
| ML API | FastAPI + Uvicorn | 0.135.1 / 0.41.0 | Wait-time prediction endpoint |
| Database | PostgreSQL via Supabase | — | Cloud-hosted relational DB |
| ORM (Python) | SQLAlchemy | 2.0.48 | FastAPI ↔ PostgreSQL |
| DB Driver (Node) | pg (node-postgres) | 8.13.3 | Express ↔ PostgreSQL |
| Auth | bcrypt + jsonwebtoken | 6.0.0 / 9.0.3 | Password hashing + JWT tokens |
| Email (OTP) | Nodemailer + Gmail SMTP | 8.0.2 | OTP and confirmation emails |
| ML Model | scikit-learn LinearRegression | 1.8.0 | Wait-time prediction |
| Data | pandas + numpy | 2.3.2 / 2.3.3 | ML data processing |
| Testing | pytest | 9.0.2 | Python test suite |
| Dev Server | nodemon | 3.1.14 | Express auto-restart |
| Runtime | Node.js | 18+ | JavaScript runtime |
| Runtime | Python | 3.11+ | Python runtime |

---

## ✅ Prerequisites

Install all of these before beginning setup. Tick each one off before proceeding.

**Required Software**

- [ ] [Node.js 18+](https://nodejs.org) — `node --version` should print `v18.x.x` or higher
- [ ] [Python 3.11+](https://python.org/downloads) — `python --version` should print `3.11.x` or higher
- [ ] [Git](https://git-scm.com) — for cloning the repository
- [ ] [VS Code](https://code.visualstudio.com) — recommended editor
- [ ] VS Code extension: **Live Server** (`ritwickdey.LiveServer`) — to serve the frontend HTML

**Required Cloud Account**

- [ ] [Supabase account](https://supabase.com) (free tier is sufficient) — for the PostgreSQL database

**Required Google Account Configuration**

- [ ] A Gmail account to use as the OTP sender
- [ ] [Google App Password](https://myaccount.google.com/apppasswords) generated for this app
  - Google Account → Security → 2-Step Verification (must be ON) → App Passwords → Generate

---

## 🚀 Installation & Setup

Follow these steps **in order**. Do not skip any step.

---

### Step 1 — Clone & Environment

```bash
# 1. Clone the repository
git clone https://github.com/ARIEA-hub/qsense.git
cd qsense

# 2. Create your .env file from the template
# (do NOT copy the old .env from any prior ZIP — those credentials are compromised)
touch .env
```

Open `.env` in your editor and paste the following template. Fill in every value:

```env
# ─── Server ────────────────────────────────────────────────
PORT=5000
FRONTEND_ORIGIN=http://127.0.0.1:5501

# ─── Supabase PostgreSQL ────────────────────────────────────
# Get this from: Supabase Dashboard → Settings → Database → URI
# (use the "Transaction" mode URI, port 6543)
DATABASE_URL=postgresql://postgres.[YOUR-PROJECT-REF]:[YOUR-DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres

# ─── JWT Authentication ─────────────────────────────────────
# Generate a secure secret with this command:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=REPLACE_THIS_WITH_64_CHARACTER_HEX_STRING
JWT_EXPIRY=24h

# ─── Email / OTP ────────────────────────────────────────────
EMAIL_USER=your-gmail-address@gmail.com
EMAIL_PASS=your-16-character-app-password

# ─── OTP Behaviour ──────────────────────────────────────────
OTP_EXPIRY_MINS=10
```

> **JWT_SECRET generation command:**
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```
> Copy the output (64 hex characters) into your `.env`.

---

### Step 2 — Node.js Backend Setup

```bash
# Install all Node.js dependencies
npm install

# Verify the pg driver is installed (replaces mysql2)
npm list pg
# Expected: pg@8.x.x

# If you see mysql2 still listed, remove it
npm uninstall mysql2
npm install pg
```

---

### Step 3 — Database Setup (Supabase)

#### 3a. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Choose your organisation, set a project name (e.g. `qsense-db`), and set a **strong database password**
3. Select the region closest to you
4. Wait for provisioning (≈60 seconds)

#### 3b. Get Your Connection String

1. In your Supabase project → **Settings** → **Database**
2. Scroll to **Connection String** → select **URI** mode
3. Switch to the **Transaction** pooler tab (port **6543**)
4. Copy the full URI — it looks like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
5. Paste it as `DATABASE_URL` in your `.env`

#### 3c. Initialise the Database Schema

```bash
# Install Python dependencies first
pip install psycopg2-binary python-dotenv

# Run the schema creation script
python scripts/init_db.py
```

Expected output:
```
✅ Database schema created successfully.
   Tables: restaurant, customer, admin, restaurant_tables, reservation, queue
```

This creates all 6 tables with the correct columns (including `is_verified` for account activation and `latitude`/`longitude` for live location tracking) and seeds three example Mumbai restaurants.

#### 3d. Verify the Connection from Express

```bash
# Start the Express server briefly to test DB
npm start

# In a new terminal:
curl http://localhost:5000/test-db
```

Expected response:
```json
{
  "message": "Database Connected Successfully.",
  "server_time": "2026-07-26T12:00:00.000Z"
}
```

---

### Step 4 — Python / ML Setup

```bash
# Create a Python virtual environment (strongly recommended)
python -m venv venv

# Activate it
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install all Python dependencies
pip install -r requirements.txt

# Verify FastAPI and uvicorn installed correctly
python -c "import fastapi, uvicorn; print('FastAPI OK')"
```

> **Windows Note:** Some packages in `requirements.txt` are Windows-only (`winrt-*`, `pyinstaller`). If you are on macOS or Linux, install only what you need:
> ```bash
> pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv \
>             scikit-learn pandas numpy joblib pytest
> ```

---

### Step 5 — Email (OTP) Configuration

OTP emails require a Gmail address with an App Password.

1. Sign in to the Gmail account you want to use as the sender
2. Go to [myaccount.google.com/security](https://myaccount.google.com/security)
3. Ensure **2-Step Verification** is turned ON
4. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
5. Select **Mail** as the app → **Other (custom name)** → type `Q-Sense` → click **Generate**
6. Copy the 16-character password (shown once only)
7. In your `.env`:
   ```env
   EMAIL_USER=the-gmail-address-you-used@gmail.com
   EMAIL_PASS=xxxx xxxx xxxx xxxx
   ```

**Test the email config:**
```bash
# Start the Express server, then POST a test OTP
curl -X POST http://localhost:5000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "YOUR-OWN-EMAIL@gmail.com", "role": "customer"}'
```

Expected response: `{"success":true,"message":"Verification code sent."}`

Check your inbox — a verification email should arrive within 30 seconds.

---

### Step 6 — Train the ML Model

The pre-trained `.pkl` model is included in the repository but you should retrain it if you have real data.

```bash
# Make sure your virtual environment is active, then:
python src/models/train_model.py
```

Expected output:
```
Model trained and saved successfully.
```

Confirm the model file exists:
```bash
ls models/wait_time_model.pkl   # macOS/Linux
dir models\wait_time_model.pkl  # Windows
```

---

## ▶️ Running the Application

You need **three terminal windows** to run the complete stack.

### Terminal 1 — Express Backend (main API)

```bash
# Development mode (auto-restarts on file changes)
npm run dev

# OR production mode
npm start
```

Server starts at: **`http://localhost:5000`**

Look for:
```
✅ Q-Sense server running on port 5000
   CORS origin: http://127.0.0.1:5501
```

---

### Terminal 2 — FastAPI ML Server

```bash
# Activate virtual environment first
source venv/bin/activate   # macOS/Linux
# venv\Scripts\activate    # Windows

# Start FastAPI with auto-reload
uvicorn api.main:app --reload --port 8000
```

Server starts at: **`http://localhost:8000`**

API docs available at: **`http://localhost:8000/docs`** (Swagger UI, auto-generated)

---

### Terminal 3 — Frontend (Live Server)

1. Open VS Code in the project folder
2. Right-click `frontend/index.html` in the Explorer sidebar
3. Select **"Open with Live Server"**

Frontend opens at: **`http://127.0.0.1:5501/frontend/index.html`**

> **Port matters.** The CORS policy in `.env` sets `FRONTEND_ORIGIN=http://127.0.0.1:5501`. If Live Server uses a different port, update `FRONTEND_ORIGIN` in your `.env` and restart the Express server.

---

### Startup Checklist

Verify each of these before testing end-user flows:

```
✅ http://localhost:5000/             → {"status":"ok","message":"Q-Sense Backend Running"}
✅ http://localhost:5000/test-db      → {"message":"Database Connected Successfully.",...}
✅ http://localhost:5000/api/restaurant → JSON array with restaurant data
✅ http://localhost:8000/             → {"message":"Q-Sense ML API Running",...}
✅ http://localhost:8000/docs         → Swagger UI loads
✅ http://127.0.0.1:5501/frontend/index.html → Landing page loads
```

---

## 📡 API Reference

### Express Backend — `http://localhost:5000`

#### Health

| Method | Endpoint | Auth | Description |
|--------|---------|------|-------------|
| GET | `/` | None | Server health check |
| GET | `/test-db` | None | Database connectivity check |

#### Restaurants

| Method | Endpoint | Auth | Description |
|--------|---------|------|-------------|
| GET | `/api/restaurant` | None | All restaurants with coordinates |
| GET | `/api/restaurant/open` | None | Open restaurants only |
| GET | `/api/restaurant/:id` | None | Single restaurant by ID |

#### Customer Auth

| Method | Endpoint | Body | Description |
|--------|---------|------|-------------|
| POST | `/api/users/register` | `{name, email, phone, password}` | Register + trigger OTP email |
| POST | `/api/users/login` | `{email, password}` | Login → returns JWT token |
| GET | `/api/users/:id` | — | Get customer profile |

#### Admin Auth

| Method | Endpoint | Body | Description |
|--------|---------|------|-------------|
| POST | `/api/admin/register` | `{name, email, phone, password, role, restaurant_id}` | Register admin + trigger OTP |
| POST | `/api/admin/login` | `{email, password}` | Login → returns JWT token |
| GET | `/api/admin/:id` | — | Get admin profile |
| GET | `/api/admin/reservations/pending/:restaurantId` | — | Pending reservations for restaurant |
| PUT | `/api/admin/reservations/:reserveId/allocate` | `{table_id}` | Allocate table + email customer |

#### OTP

| Method | Endpoint | Body | Description |
|--------|---------|------|-------------|
| POST | `/api/send-otp` | `{email, role}` | Send 6-digit OTP to email |
| POST | `/api/verify-otp` | `{email, otp, role}` | Verify OTP → set `is_verified=true` |

#### Reservations

| Method | Endpoint | Body | Description |
|--------|---------|------|-------------|
| POST | `/api/reservations/create` | `{customer_id, restaurant_id, group_size, reserve_date, reserve_time}` | Book table |
| GET | `/api/reservations/user/:customerId` | — | Customer's active reservations |
| DELETE | `/api/reservations/:reserveId` | — | Cancel reservation |

#### Queue

| Method | Endpoint | Body | Description |
|--------|---------|------|-------------|
| POST | `/api/queue/join` | `{restaurant_id, customer_id, group_size}` | Join restaurant queue |
| GET | `/api/queue/status/:queueId` | — | Position + estimated wait |
| GET | `/api/queue/admin/:restaurantId` | — | Full queue list for admin |
| PUT | `/api/queue/update/:queueId` | `{status}` | Update queue entry status |

#### Tables

| Method | Endpoint | Body | Description |
|--------|---------|------|-------------|
| GET | `/api/tables/restaurant/:id` | — | All tables for a restaurant |
| PATCH | `/api/tables/:tableId/status` | `{status}` | Update table status |

#### Location (Live GPS — Feature C)

| Method | Endpoint | Body/Query | Description |
|--------|---------|-----------|-------------|
| POST | `/api/location/update` | `{customer_id, latitude, longitude}` | Store customer GPS coordinates |
| GET | `/api/location/restaurant/:id` | — | Restaurant coordinates |
| GET | `/api/location/nearby` | `?lat=&lng=&radius_km=` | Restaurants sorted by distance |

---

### FastAPI ML Server — `http://localhost:8000`

| Method | Endpoint | Query Params | Description |
|--------|---------|-------------|-------------|
| GET | `/` | — | API health check |
| GET | `/api/predict` | `party_size`, `queue_length`, `tables_available` | ML wait-time prediction |
| GET | `/api/restaurants` | — | Restaurant list from DB |
| GET | `/api/restaurants/open` | — | Open restaurants only |
| GET | `/api/restaurants/{id}` | — | Single restaurant |
| GET | `/docs` | — | Swagger interactive documentation |

**Prediction example:**
```
GET http://localhost:8000/api/predict?party_size=4&queue_length=8&tables_available=2

Response:
{
  "predicted_wait_time_minutes": 24.5,
  "inputs": {
    "party_size": 4,
    "queue_length": 8,
    "tables_available": 2
  }
}
```

---

## 🖥️ Frontend Pages

| Page | File | Who Uses It |
|------|------|------------|
| Landing | `index.html` | All visitors |
| Customer Sign Up | `CustomerSignUp.html` | New customers |
| Customer Login | `CustomerLogin.html` | Returning customers |
| Customer Dashboard | `CustomerDashboard.html` | Logged-in customers |
| Book a Table | `CustomerReservation.html` | Logged-in customers |
| Join Queue | `JoinQueue.html` | Walk-in customers |
| Live Locations | `locations.html` | All users (GPS map) |
| OTP Verification | `OtpVerification.html` | New registrations (both roles) |
| Admin Sign Up | `AdminSignUp.html` | New restaurant staff/managers |
| Admin Login | `AdminLogin.html` | Restaurant staff/managers |
| Admin Dashboard | `AdminDashboard.html` | Logged-in admins |
| Table Management | `AdminTableManagement.html` | Logged-in admins |

---

## 🧪 Testing

### Manual API Testing (Thunder Client / REST Client)

Install the **Thunder Client** extension in VS Code (`rangav.vscode-thunder-client`).

The `.http` files in the project root contain pre-built requests:
- `.http` — tests `POST /api/users`
- `2.http` — tests `GET /api/users`

Import these into Thunder Client or use the REST Client extension directly.

### Registration + OTP Flow Test (Terminal)

```bash
# 1. Register a test customer
curl -X POST http://localhost:5000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@yourdomain.com","phone":"9000000000","password":"test1234"}'

# Expected: {"message":"Account created...","requires_otp":true,"customer_id":1}

# 2. Try to login before verifying — should be blocked
curl -X POST http://localhost:5000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@yourdomain.com","password":"test1234"}'

# Expected: {"message":"Account not verified...","requires_otp":true}

# 3. Check your email inbox for the 6-digit code, then:
curl -X POST http://localhost:5000/api/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@yourdomain.com","otp":"REPLACE_WITH_REAL_CODE","role":"customer"}'

# Expected: {"success":true,"message":"Account verified successfully!..."}

# 4. Login should now succeed
curl -X POST http://localhost:5000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@yourdomain.com","password":"test1234"}'

# Expected: {"message":"Login successful","customer_id":1,"token":"eyJ..."}
```

### Python / ML Tests (pytest)

```bash
# Activate virtual environment
source venv/bin/activate

# Run all tests
pytest tests/test_prediction.py -v

# Expected output (if model is trained):
# tests/test_prediction.py::TestPredictWaitTime::test_returns_float                PASSED
# tests/test_prediction.py::TestPredictWaitTime::test_positive_wait_time           PASSED
# tests/test_prediction.py::TestPredictWaitTime::test_larger_queue_means_more_wait PASSED
# tests/test_prediction.py::TestPredictWaitTime::test_zero_queue_returns_result    PASSED
# tests/test_prediction.py::TestPredictWaitTime::test_one_decimal_precision        PASSED
# tests/test_prediction.py::TestPredictEndpoint::test_predict_returns_200          PASSED
# tests/test_prediction.py::TestPredictEndpoint::test_predict_response_structure   PASSED
# tests/test_prediction.py::TestPredictEndpoint::test_predict_invalid_party_size   PASSED
# tests/test_prediction.py::TestPredictEndpoint::test_predict_missing_params       PASSED
# tests/test_prediction.py::TestPredictEndpoint::test_restaurants_endpoint         PASSED
```

---

## 🔑 Environment Variables Reference

All variables live in `.env` at the project root. Never commit this file.

| Variable | Required | Example Value | Notes |
|----------|----------|--------------|-------|
| `PORT` | Yes | `5000` | Express server port |
| `FRONTEND_ORIGIN` | Yes | `http://127.0.0.1:5501` | Must match Live Server port exactly |
| `DATABASE_URL` | Yes | `postgresql://postgres.[ref]:...` | Full Supabase connection URI |
| `JWT_SECRET` | Yes | `a94f3b...` (64 hex chars) | Generate with `crypto.randomBytes(32).toString('hex')` |
| `JWT_EXPIRY` | No | `24h` | Token lifetime. Supports `1h`, `7d`, etc. |
| `EMAIL_USER` | Yes | `yourname@gmail.com` | Gmail sender address |
| `EMAIL_PASS` | Yes | `xxxx xxxx xxxx xxxx` | Google App Password (16 chars) |
| `OTP_EXPIRY_MINS` | No | `10` | Minutes before OTP expires (default: 10) |

---

## 🔥 Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Access denied for user 'root'@'localhost'` | Old MySQL config still active | Ensure `DATABASE_URL` is set in `.env` and `api/database.js` uses `pg`, not `mysql2` |
| `MODULE_NOT_FOUND: Cannot find module './routes/...'` | Missing route file | Check that all files in `api/routes/` exist. Run `ls api/routes/` |
| `Failed to load restaurants.` | Empty DB or query error | Run `python scripts/init_db.py` to seed data. Check `GET /test-db` passes first |
| `error: self-signed certificate` | SSL issue with Supabase | Ensure `ssl: { rejectUnauthorized: false }` is in `api/database.js` pool config |
| `CORS error in browser` | `FRONTEND_ORIGIN` mismatch | Check the port Live Server is using. Update `FRONTEND_ORIGIN` in `.env` to match. Restart Express. |
| `Invalid credentials` on login | Account not verified | The account's `is_verified = false`. Complete OTP verification first. |
| `FileNotFoundError: wait_time_model.pkl` | Model not trained | Run `python src/models/train_model.py` |
| OTP email not arriving | Gmail SMTP config wrong | Verify `EMAIL_USER` and `EMAIL_PASS` in `.env`. Ensure 2FA is ON in Google Account. App Passwords require 2FA. |
| `Network error` on frontend | Express not running | Check Terminal 1. Run `npm run dev` and confirm server starts on port 5000. |
| `422 Unprocessable Entity` (FastAPI) | Missing query parameters | FastAPI route requires all three query params: `party_size`, `queue_length`, `tables_available` |
| Leaflet map not loading | Missing CDN or JS error | Check `locations.html` includes the Leaflet CSS and JS CDN links. Open browser DevTools → Console tab. |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes following the project's code style
4. Run tests: `pytest tests/ -v`
5. Commit with a conventional message: `git commit -m "feat: add reservation cancellation endpoint"`
6. Push: `git push origin feature/your-feature-name`
7. Open a Pull Request with a description of what changed and why

**Commit message convention:**

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `refactor:` | Code change that is not a bug fix or feature |
| `docs:` | Documentation only |
| `test:` | Adding or fixing tests |
| `chore:` | Build, config, dependency updates |

**Before submitting a PR, confirm:**
- [ ] `.env` is not committed
- [ ] No hardcoded credentials in any source file
- [ ] `pytest tests/ -v` passes
- [ ] All new API endpoints are tested with Thunder Client
- [ ] Any new environment variables are documented in this README

---

## 📄 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2026 ARIEA-hub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

See [LICENSE](LICENSE) for the full text.

---

## 🙏 Acknowledgements

- [Leaflet.js](https://leafletjs.com) — open-source interactive maps
- [OpenStreetMap](https://www.openstreetmap.org) — map tile data
- [Supabase](https://supabase.com) — open-source Firebase alternative (PostgreSQL hosting)
- [FastAPI](https://fastapi.tiangolo.com) — high-performance Python web framework
- [scikit-learn](https://scikit-learn.org) — machine learning in Python
- [Express.js](https://expressjs.com) — minimal Node.js web framework
- [Inter font](https://rsms.me/inter/) — the typeface used throughout the UI

---

<div align="center">

Built with ❤️ by [ARIEA-hub](https://github.com/ARIEA-hub)

*Q-Sense — Making waiting smarter, one queue at a time.*

</div>

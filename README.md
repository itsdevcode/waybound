# WAYBOUND

An open-source AI adventure companion that turns nearby places into personalized real-world quests, encouraging people to explore, walk, connect, and spend more time outdoors.

---

## Architecture Overview

WAYBOUND combines a FastAPI backend with real-world geospatial intelligence, open LLMs, and a mobile-first Next.js explorer client:

- **Quest Engine & Progression APIs (Phase 1)**: User accounts, archetype profiles, progression leveling (`level = 1 + (xp // 500)`), atomic quest verification, step/hint progression, and state transitions (`draft` -> `active` -> `completed` / `abandoned`).
- **AI Game Master (Phase 2)**:
  - **Google Places API (New)** (`POST https://places.googleapis.com/v1/places:searchNearby`): Discovers real public parks, monuments, historical landmarks, museums, and botanical gardens.
  - **Minimal Field Mask**: Uses `places.id,places.displayName,places.location,places.primaryType,places.formattedAddress,places.businessStatus` to eliminate expensive review, rating, and photo billing costs.
  - **Gemma AI**: Generates RPG quest narratives and progressive clues.
  - **Anti-Hallucination & Anti-Spoofing Guardrails**:
    - Selects exclusively from real nearby candidate place IDs; rejects invented locations and hallucinated place IDs. Never silently falls back to other destinations.
    - Early clues conceal destination names and landmark identifiers.
    - Sanitized logging: Secrets, raw prompts, and raw LLM traces are never disclosed to clients or logs.
- **Explorer Frontend (Phase 3)**:
  - Mobile-first fantasy exploration web application in Next.js (App Router), TypeScript, and Tailwind CSS.
  - Native browser Geolocation integration with high-accuracy GPS coordinates and robust permission handling.
  - Progressive clue unlock flow with strict client-side destination secrecy prior to verified arrival.
  - Explorer progression dashboard (XP level progress bars, journal history, archetype crests).
  - Explicit demo mode integration and transparent ground truth safety.

---

## Provider Modes

WAYBOUND supports explicit provider modes via backend configuration (`QUEST_PROVIDER`):

| Mode | Description | Verification & Progression Behavior |
| --- | --- | --- |
| `demo` (default) | Simulated, fictional scenarios for local development and automated testing. | Observation answers verified against deterministic simulated rules; awards demo XP. Clearly labeled as simulated content. |
| `google_places_gemma` | Live Google Places candidate discovery + Gemma narrative generation. | Requires `latitude` and `longitude`. Strict failure mode: Never silently falls back to demo mode if Google Places or Gemma fails. |

---

## Real-World Verification Safety & Limitations

> [!IMPORTANT]
> **Observation Answers as Unverified Hypotheses**: LLM-generated observation questions and answers (e.g., asking what inscription date or statue feature exists at a site) are AI hypotheses and **must not be treated as trusted, field-verified ground truth**.

- **Provisional Observation Verification & Safe XP**:
  - Real-world AI-generated quests currently use **provisional observation verification**.
  - While AI observation answers remain unverified, real-world quests allow completion and destination discovery once verified at the physical site, but **award exactly 0 XP** (`reward_xp_awarded = 0`). This strictly prevents exploiting fabricated ground truth to inflate real-world explorer level/XP.
  - No client input or environment flag can override this real-world XP restriction. Simulated demo quests continue to award XP under verified deterministic test rules.
- **Geographic Proximity**: Arrival verification requires the explorer to be within `VERIFICATION_RADIUS_METERS` (default `100.0m`) calculated via the Haversine formula.
- **Search Radius Bounds**: Google Places search radius must be between `100m` and `50,000m` (default `5000m`). Unsuitable destinations (e.g. gas stations, cemeteries, storage, prisons, closed businesses) are automatically excluded.
- **Geolocation Security**: Native browser geolocation requires a secure context (HTTPS or localhost).

---

## Backend Configuration & Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Environment variables:

| Environment Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | - | Async PostgreSQL connection string (`postgresql+asyncpg://...`) |
| `QUEST_PROVIDER` | `demo` | Provider mode: `demo` or `google_places_gemma` |
| `GOOGLE_MAPS_API_KEY` | - | Google Cloud API key with Places API (New) enabled |
| `GOOGLE_PLACES_SEARCH_RADIUS_METERS` | `5000.0` | Default discovery radius in meters |
| `GOOGLE_PLACES_MIN_RADIUS_METERS` | `100.0` | Minimum allowed search radius |
| `GOOGLE_PLACES_MAX_RADIUS_METERS` | `50000.0` | Maximum allowed search radius |
| `GOOGLE_PLACES_TIMEOUT_SECONDS` | `10.0` | HTTP timeout for Google Places calls |
| `GEMMA_API_KEY` | - | API key for Gemma provider (Google AI or OpenAI compatible) |
| `GEMMA_MODEL` | `gemma-2-9b-it` | Gemma model identifier |
| `GEMMA_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Gemma base URL (Google AI or local vLLM/Ollama) |
| `GEMMA_TIMEOUT_SECONDS` | `30.0` | HTTP timeout for Gemma calls |
| `GEMMA_MAX_RETRIES` | `3` | Maximum retry attempts for transient Gemma API failures |
| `VERIFICATION_RADIUS_METERS` | `100.0` | Maximum arrival geofence tolerance in meters |

3. Run migrations and seed the demo explorer:
```bash
alembic upgrade head
PYTHONPATH=. .venv/bin/python3 scripts/seed_demo_user.py
```

4. Start the FastAPI backend:
```bash
PYTHONPATH=. .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

---

## Frontend Installation & Development (Phase 3)

The Explorer Frontend is located in `frontend/`.

### 1. Installation
```bash
cd frontend
npm install
```

### 2. Environment Configuration
Create or inspect `frontend/.env.local`:
```bash
# Points to FastAPI backend (defaults to http://localhost:8000)
NEXT_PUBLIC_API_URL=http://localhost:8000
```
> [!NOTE]
> Sensitive keys like `GOOGLE_MAPS_API_KEY` and `GEMMA_API_KEY` are kept strictly server-side on the FastAPI backend and never exposed in the frontend environment.

### 3. Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser (use mobile viewport emulation for the optimal touch experience).

### 4. Production Build & Linting
```bash
# Run ESLint checks
npm run lint

# Run TypeScript typecheck
npm run typecheck

# Run Frontend Vitest Suite (12 tests)
npm test

# Build production bundle
npm run build
```

---

## Demo Walkthrough Guide

Follow these steps to demonstrate the full hackathon MVP experience:

1. **Seed or Connect Demo Explorer**:
   - Run `PYTHONPATH=. .venv/bin/python3 scripts/seed_demo_user.py` to ensure the default demo explorer (`00000000-0000-0000-0000-000000000001`) exists in the database.
   - The frontend automatically selects this Explorer by default, displaying their Level, XP progress bar, and archetype.
2. **Begin Adventure**:
   - Tap **"BEGIN ADVENTURE"** on the dashboard.
   - Select your preferred duration (15, 30, or 60 min), explorer archetype (`Mystery`, `Discovery`, `Nature`, `Fitness`, `Social`), and difficulty.
   - Tap **"Acquire Current GPS Location"** to grant browser permission (in demo mode, simulated quests can also be generated without GPS).
   - Tap **"Summon Quest"**.
3. **Inspect the Draft Quest**:
   - View the generated title, immersive field transmission story, difficulty, and duration.
   - Notice the **Destination Secret**: The destination name and coordinates remain strictly sealed.
4. **Embark & Progressive Clues**:
   - Tap **"Embark on Quest (Unlock Clue #1)"**. The quest transitions to `active` and reveals the first clue.
   - Tap **"Unlock Next Clue"** to reveal subsequent hints sequentially.
5. **Verify Completion**:
   - Tap **"Verify Arrival & Answer"**.
   - Capture your verification GPS and enter the site observation answer.
   - For demo quest `Central Library Courtyard` (coords `37.779260, -122.416040`), the answer is `owl`.
   - On submission, the destination is unlocked, actual backend XP is awarded atomically, and your Explorer level advances!
6. **Real-World Safety Mode**:
   - In `google_places_gemma` mode, completions clearly display `0 XP Awarded` with a ground-truth notification to prevent progression exploitation from AI-generated hypotheses.

---

- **Voice Game Master (Phase 4A)**:
  - Spoken AI Game Master using Web Speech API with destination secrecy enforcement.
- **Social Mystery Partner (Phase 4B)**:
  - Two-player cooperative mystery quests with split, complementary clues.
  - Server-side authenticated sessions (Bearer tokens) eliminating client-supplied UUID spoofing.
  - Proof-of-Identity email OTP authentication (`POST /auth/otp/request` and `POST /auth/otp/verify`) with HMAC-SHA256 salted hashes and sliding-window rate limiting.
  - Dedicated demo authentication (`POST /auth/demo-session`) isolated to the seeded demo explorer and strictly disabled in production (`ALLOW_DEMO_AUTH=false`).
  - Active session logout and revocation (`POST /auth/logout`).
  - Strict two-member party constraint enforced via atomic database transactions and constraints.
  - Fast reservation mechanism (`generating_quest` status) that releases database row locks during external Google Places and Gemma generation.
  - Location-grounded, complementary split clues derived from real place features without generic filler.
  - Server-side independent GPS arrival verification without disclosing raw coordinates or live location to the partner.
  - Nicknames by default; mutual consent required to reveal real explorer identities.
  - Anti-exploit XP safety rule preserved: Real-world AI observation hypothesis awards 0 XP.

---

## Two-Browser Cooperative Gameplay Testing Guide

To test the two-player mystery experience locally using two browser windows (or one normal window and one incognito window):

1. **Window A (Host Explorer - "Seeker")**:
   - Navigate to [http://localhost:3000](http://localhost:3000).
   - In the top navigation toggle, switch from **"Solo Expedition"** to **"Mystery Fellowship"**.
   - Under **"Form Fellowship"**, enter Fellowship Name (e.g. `Order of the Key`) and Explorer Nickname (e.g. `Seeker`). Click **"Form Fellowship"**.
   - In the fellowship lobby, click **"Copy Secret Token"** to copy the opaque invitation token (`wb_inv_...`).
   - The lobby shows `Seeker (Host)` and displays `Waiting for a second explorer to join...`.

2. **Window B (Partner Explorer - "Scholar" / Incognito)**:
   - Navigate to [http://localhost:3000](http://localhost:3000) in an incognito window or second browser.
   - Switch to **"Mystery Fellowship"**.
   - Under **"Join Existing Fellowship"**, paste the copied invitation token and choose a nickname (e.g. `Scholar`). Click **"Join Fellowship"**.
   - The lobby updates in both windows automatically (via background synchronization) showing both explorers assembled!

3. **Window A (Host Begins Cooperative Quest)**:
   - Under **"Embark on Cooperative Quest"**, choose duration and archetype, then click **"Start Two-Player Cooperative Quest"**.
   - Both windows transition to the **Active Cooperative Quest** screen.

4. **Verify Clue Privacy & Voice Narration**:
   - Notice that Window A receives **Fragment I** (Slot 1 perspective) while Window B receives **Fragment II** (Slot 2 perspective).
   - Neither explorer's browser receives or displays the partner's clue text.
   - The Voice Game Master only reads the player's own visible clues and shared story—never the partner's hidden clues or destination secret.

5. **Mutual Consent & Identity Protection**:
   - Both players see only the partner's chosen nickname (`Seeker` and `Scholar`).
   - If Player A clicks **"Consent to Reveal Real Name"**, Player B still only sees the nickname until Player B also consents.
   - Either player can revoke consent at any time to re-cloak their identity.

6. **Server-Side Verification & Completion**:
   - Both explorers must independently click **"Verify Arrival & Answer"** to provide their GPS location and observation answer.
   - In Window A, submit coordinates `37.779260, -122.416040` and answer `owl`. Window A marks verified, while the quest remains waiting for the partner.
   - In Window B, submit the observation. Once both have verified, the quest atomically completes, destination is unveiled, and shared XP is rewarded!

---

## Phase 4C: ElevenLabs Premium Voice Game Master

WAYBOUND incorporates an optional, studio-quality Text-to-Speech integration powered by **ElevenLabs**, augmenting the free built-in browser `speechSynthesis` Voice Game Master.

### 1. Dual-Provider Architecture & Automatic Browser Fallback
- **Three Voice Modes**: Explorers can toggle between **Off**, **Browser (Free Device TTS)**, and **ElevenLabs (Studio AI)** directly from the active quest header and voice settings bar. Preferences persist automatically in `localStorage`.
- **Zero Gameplay Disruption**: If ElevenLabs is unconfigured, disabled, rate-limited, times out, or exhausts API credits, WAYBOUND automatically and gracefully falls back to browser speech synthesis. Quest gameplay, progression, and verification are never interrupted.
- **Single Playback Constraint**: A centralized, thread-safe `speechController` ensures that only one voice narration stream plays at any given time. Starting speech automatically stops prior tracks, and navigating away or abandoning quests immediately cleans up active audio.

### 2. Credit Conservation & Server-Side LRU Caching
To protect quota and optimize free-tier credit consumption:
- **Server-Side Narration Caching**: Repeated narration requests (e.g., replaying quest descriptions or unlocked clues) are cached in an in-memory LRU cache (`NARRATION_CACHE_MAX_ITEMS`, default 500 items). Cache keys incorporate `voice_id::model_id::auth_scope::text`. Cached hits avoid external ElevenLabs API calls entirely.
- **Input Length Caps**: Server-side synthesis restricts inputs to a maximum of 2,000 characters per utterance.
- **Rate Limiting**: Dedicated rate limiting (`ELEVENLABS_RATE_LIMIT_PER_MINUTE`, default 20 req/min) prevents rapid credit depletion and abuse.
- **Client Cache-Control**: Audio responses are delivered with `Cache-Control: private, max-age=3600` so client browsers cache MP3 chunks during an active quest session.

### 3. Destination Secrecy & Server-Side Security
- **Strictly Server-Side Credentials**: `ELEVENLABS_API_KEY` is kept strictly server-side and is never sent to the browser or client bundle.
- **No Arbitrary User Text Synthesis**: The `/api/v1/narration/synthesize` endpoint rejects unrestricted client-supplied text. Narration is generated exclusively from authorized, unlocked quest events (`story`, unlocked `clue`, or verified `completion`).
- **Destination Secrecy Enforced**: Hidden destination names, coordinates, and locked clues are strictly forbidden from narration.
- **Cooperative Fellowship Isolation**: In multiplayer cooperative quests, an explorer can only narrate clues assigned to their own slot; partner-private clues cannot be synthesized.

### 4. ElevenLabs API Setup & Free-Tier Guidance
1. Create an account at [elevenlabs.io](https://elevenlabs.io) and obtain an API Key from Profile -> API Keys.
2. Ensure your API key has the `text_to_speech` permission enabled.
3. Choose a Voice ID from the ElevenLabs Voice Library (e.g., `21m00Tcm4TlvDq8ikWAM` - Rachel, `pNInz6obpgDQGcFmaJgB` - Adam, or custom community voices).
4. Default recommended model: `eleven_multilingual_v2` or `eleven_turbo_v2_5` (faster and lower latency).
5. Set `ELEVENLABS_ENABLED=true` in `.env` along with your `ELEVENLABS_API_KEY`.

---

## Production Security & Architecture Limitations

1. **Authentication & Identity Proof**:
   - Unauthenticated creation of sessions via arbitrary client-supplied UUIDs is completely removed.
   - Explorers authenticate via verified email OTP dispatched through configurable transactional email providers (`resend`, `smtp`, or `simulated` for dev/test).
   - In production, simulated email delivery is strictly rejected at startup; transactional email provider credentials (`RESEND_API_KEY` or `SMTP_HOST`/`SMTP_PASSWORD`) are required and kept strictly server-side.
   - OTP codes are **never** returned in API responses, logs, or error messages in production.
   - OTP records are committed only after the email provider confirms successful delivery acceptance, and are automatically rolled back upon provider errors.
   - Brute-force protection invalidates OTP codes after 5 failed attempts; replay and expired attempts are strictly rejected.
   - Demo sessions are restricted strictly to seeded demo accounts and completely forbidden when `ENVIRONMENT=production` or `ALLOW_DEMO_AUTH=false`.
   - `Settings` automatically validates at startup that `AUTH_SECRET` is at least 32 characters and does not match any default dev secrets when running in production.
2. **Multi-Worker Shared Rate Limiting**:
   - `RATE_LIMIT_STORAGE=database` coordinates sliding-window rate limiting across multi-process and multi-worker deployments via the `auth_rate_limit_entries` table.
   - Enforces IP and per-email attempt thresholds returning `429 Too Many Requests` with `Retry-After` headers.
3. **Session Revocation & Logout**:
   - Active tokens can be explicitly revoked via `POST /api/v1/auth/logout`.
   - Revoked or expired sessions are rejected immediately with 401 Unauthorized.
4. **Database Concurrency & Row Lock Safety**:
   - Cooperative quest generation uses an atomic reservation status (`generating_quest`), immediately releasing database row locks while Google Places and Gemma complete their network requests.
   - Prevents database connection starvation and transaction lock timeouts.
5. **Data Isolation & Proximity**:
   - Partner clues and raw coordinates are strictly filtered server-side in `PartyService` prior to Pydantic serialization; client bundles never receive partner clues or partner GPS coordinates over the wire.

---

## Running Full Test Suites

```bash
# 1. Backend tests (57 async pytest cases covering ElevenLabs TTS, Auth OTP, Transactional Email, Rate Limiting, Concurrency, Split Clues, Verification, and Secrecy)
PYTHONPATH=. .venv/bin/pytest tests/ -v

# 2. Frontend tests (46 Vitest cases covering ElevenLabs playback & fallback, Voice narration, OTP Auth, Party flows, Geo safety, and Secrecy)
cd frontend && npm test

# 3. Frontend Lint and Typecheck
cd frontend && npm run lint && npm run typecheck

# 4. Production Build
cd frontend && npm run build
```



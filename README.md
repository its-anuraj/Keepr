# Keepr

**Your purchases, documents, warranties, and service history — organized in one place.**

Keepr is a personal ownership vault for Android (and iOS-ready) built with React Native and Expo. It gives people a single, organized place to store purchase records, receipts, warranties, service logs, and the important documents that tend to get lost after the sale is over.

---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Solution](#the-solution)
3. [Key Features](#key-features)
4. [Screenshots](#screenshots)
5. [Architecture](#architecture)
6. [Technology Stack](#technology-stack)
7. [Getting Started](#getting-started)
8. [Environment Variables](#environment-variables)
9. [Project Structure](#project-structure)
10. [Testing and Quality](#testing-and-quality)
11. [Known Limitations](#known-limitations)
12. [Roadmap](#roadmap)
13. [License](#license)

---

## The Problem

Most people buy valuable items — electronics, appliances, furniture, vehicles, clothing — but quickly lose track of:

- When they bought something and what they paid for it.
- Receipts and invoices needed for returns, warranty claims, and accounting.
- Return deadlines that expire within days of purchase.
- Warranty periods and what they actually cover.
- Vehicle registrations, insurance documents, and utility bills.
- Service and repair history for items maintained over time.

This information ends up scattered across email threads, shoeboxes, phone photos, and forgotten folders.

---

## The Solution

Keepr brings ownership records into one place. For each purchased item, a user can record acquisition details, attach a product photo, link the original receipt, set warranty and return dates, and log every service event over the item's lifetime.

The Documents vault handles standalone paperwork — utility bills, fee receipts, vehicle registration certificates, warranty cards — that are important but not always tied to a single purchase.

A local-first design means the app reads and writes immediately on-device, with Supabase cloud sync running in the background when a network connection is available.

---

## Key Features

### Authentication and Account Management

- **Email/password registration and login** via Supabase Auth, with JWT sessions persisted to `AsyncStorage`.
- **Password reset** via email magic link (`forgot-password` → `reset-password` flow).
- **Account deletion** executed by a Supabase Edge Function (`delete-account`) that verifies the caller's JWT and purges all user data server-side using the service-role key — the key is never exposed to the client.

### Purchased Items

- Records product name, category, brand, model, serial number, purchase date, price, currency, merchant, and seller address.
- Supports category-specific fields: IMEI for mobile phones; VIN, chassis number, and engine number for vehicles; size and color for fashion items.
- Attaches product photos via camera or gallery with `expo-image-manipulator` used for image optimization before upload.
- Item images are stored in a private Supabase Storage bucket (`item-images`) at durable paths (`{userId}/items/{itemId}/photo_n.jpg`). The storage path is persisted in the database so images can be retrieved on any signed-in device via a short-lived signed URL.
- Item status lifecycle: `active`, `archived`, `resold`, `disposed`.

### Warranty and Return Tracking

- Records warranty start and end dates, provider name, warranty type (manufacturer, extended, third-party, AMC), and coverage details.
- A visual warranty progress gauge shows elapsed time and remaining days.
- Return deadline tracking with status classification: `active`, `expiring_soon`, `expired`.
- Local notifications are scheduled at 30-day and 7-day warranty expiry warnings, and at the return deadline, via `expo-notifications`.

> **Android Expo Go note:** `expo-notifications` is disabled inside Expo Go on Android from SDK 53 onwards. A native development build (`npx expo run:android`) is required to test local notification scheduling on Android.

### Receipt Scanning and AI Extraction

- Users photograph or pick a receipt or invoice from their gallery.
- The image is sent to a Supabase Edge Function (`scan-receipt`) that calls the Google Gemini multimodal API server-side. The Gemini API key is stored in the Supabase Secret Vault and is never bundled into the client.
- Gemini first validates whether the image is a genuine document. Non-documents (selfies, landscapes, chat screenshots) are rejected with a clear error message.
- For valid purchase receipts and invoices, Gemini extracts merchant name, purchase date, invoice number, line items, quantities, subtotal, tax (including GST breakdown for Indian receipts), and total amount.
- **Multi-product receipts:** A single receipt with multiple line items is structured as one grouped purchase with individual product records, preserving the shared transaction context.
- **Document classification:** Non-purchase documents (utility bills, fee receipts, vehicle registration certificates) are classified and routed to the Documents vault rather than creating spurious item records.
- Extracted fields are presented for user review and editing before being saved.
- For local development without a deployed Edge Function, a Node.js proxy (`server/receipt-server.js`) can substitute, started with `npm run server:receipt`.

### Documents Vault

Documents can exist independently or be linked to a purchased item via an optional foreign key.

| Category | Example Document Types |
|---|---|
| Receipts & Invoices | Purchase receipts, tax invoices |
| Vehicle Documents | RC, insurance policy, PUC certificate |
| Warranty & Guarantee | Warranty cards, extended warranty certificates |
| Fees & Payments | College fee receipts, payment challans |
| Bills & Utilities | Electricity, water, internet, gas bills |
| Ownership & Purchase | Purchase agreements, delivery documents |
| Other Important Documents | General administrative records |

Document files are stored in a private Supabase Storage bucket (`vault-documents`) with user-scoped paths.

### Service and Repair History

The Services tab lists all maintenance and repair records across the vault. Each record captures:

- **Service type:** Repair, Maintenance, Servicing, Inspection, Part Replacement, Software/Technical, Cleaning, Other.
- Problem description, work performed, parts replaced, and technician notes.
- Service provider name, address, and phone number.
- Amount paid and currency.
- Warranty coverage status (yes / no / unknown) and coverage reference number.
- Post-service warranty and guarantee end dates.
- Linked item — optional. Records can exist for items not yet in the vault.

### Search, Sort, and Filter

Implemented across the Items and Services screens:

- **Real-time search** across item name, merchant, brand, model, serial number, and notes.
- **Sort options:** Recently added, purchase date (newest/oldest), price (high/low), alphabetical (A–Z / Z–A).
- **Filter modal:** Filter by category and warranty status (Active, Expiring Soon, Expired).
- **Recently Added feed** on the Vault dashboard combines items and documents chronologically, with incremental batch loading.

### Local-First State and Sync Queue

- All reads and writes go to Zustand stores backed by `AsyncStorage`, completing immediately without waiting for the network.
- When a cloud write fails, the operation is enqueued in `syncQueueService` under a deterministic ID (`${type}::${entityId}`). A delete for the same entity automatically supersedes any queued upsert.
- The queue is flushed on reconnection, app launch, and session restoration. Each operation is retried independently.
- Queue state is namespaced per user ID, preventing cross-account data leakage on shared devices.

### Vault Dashboard

The home screen displays summary metrics (total items, total documents, active warranties, warranties expiring soon, items with active return windows, total replacement value), a pull-to-refresh recently-added feed, and upcoming deadline highlights.

---

## Screenshots

> *Screenshots are not currently committed to this repository. To preview the application, build a development client with `npx expo run:android` and connect a physical device or emulator.*

---

## Architecture

### Data Flow

```
[ User Interaction ]
        |
        v
[ React Native / Expo UI ]
  +-- App Screens  (app/)
  +-- Reusable Components  (src/components/)
  +-- Modals & Workflows
        |
        v
[ Zustand Stores ] --(AsyncStorage persistence)--> [ Device Storage ]
  +-- itemStore       - items, documents, warranties, maintenance records, receipts
  +-- authStore       - session, profile, sign-in/out, account deletion
  +-- receiptSessionStore - active scan-and-review session
        |
        +--[Online sync]--> [ Supabase PostgreSQL + RLS ]
        |                    +-- items, warranties, documents, receipts
        |                    +-- maintenance_records, expenses, activity_logs
        |
        +--[Failed writes]--> [ syncQueueService (AsyncStorage) ]
        |                      +-- Retried on reconnect / app launch / session restore
        |
        +--[File upload]--> [ Supabase Storage (Private Buckets) ]
        |                    +-- item-images     / {userId}/items/{itemId}/photo_n.jpg
        |                    +-- vault-documents / {userId}/vault/{docId}/photo_n.jpg
        |
        +--[AI scanning]--> [ Supabase Edge Function: scan-receipt ]
                              +-- Google Gemini Multimodal API (key in Supabase Vault)
```

### Security Boundaries

```
+--------------------------------------------------------+
|                    Mobile Client                       |
|  * Anon key only (EXPO_PUBLIC_SUPABASE_ANON_KEY)       |
|  * Session JWT attached to every Supabase request      |
|  * No Gemini key, no service-role key                  |
+--------------------+-----------------------------------+
                     | HTTPS / JWT
                     v
+--------------------------------------------------------+
|                  Supabase Cloud                        |
|  * RLS on every table (auth.uid() = user_id)           |
|  * All 3 storage buckets: public = false               |
|  * Storage paths enforced: {auth.uid()}/...            |
+--------------+--------------------------+--------------+
               |                          |
               v                          v
+-------------------------+  +----------------------------+
| Edge Fn: scan-receipt   |  | Edge Fn: delete-account    |
| * GEMINI_API_KEY from   |  | * SERVICE_ROLE_KEY from    |
|   Supabase Vault        |  |   Supabase Vault           |
| * Verifies caller JWT   |  | * Purges all user data     |
+-------------------------+  +----------------------------+
```

Row Level Security is enabled on all tables (`items`, `documents`, `warranties`, `receipts`, `maintenance_records`, `expenses`, `activity_logs`, `profiles`, `reminder_preferences`). Every `SELECT`, `INSERT`, `UPDATE`, and `DELETE` policy checks `auth.uid() = user_id`.

All three Supabase Storage buckets are configured `public = false` and further protected by storage RLS policies that enforce `auth.uid()::text = (storage.foldername(name))[1]`, so the first path segment of every stored file must match the authenticated user's ID.

### Data Model

```
PURCHASED_ITEM                          DOCUMENT
------------------------------          ------------------------------
id (UUID)                               id (UUID)
name, category, brand, model            title, category, document_type
serial_number, purchase_date            document_date, issuer_name
purchase_price, currency                reference_number, amount
merchant, image_storage_path            expiry_date, due_date
return_until, warranty_until  <---+     file_path, storage_path
status, user_id (RLS boundary)    +---- item_id (optional FK)
                                        user_id (RLS boundary)
          |
          +-- MAINTENANCE_RECORD (linked or standalone)
          |     service_type, work_performed, parts_replaced
          |     service_provider, amount_paid, warranty_covered
          |     post_service_warranty_until, post_service_guarantee_until
          |
          +-- WARRANTY (start_date, end_date, provider, type, duration_months)
          |
          +-- EXPENSE (expense_type, amount, expense_date)
```

`RECEIPT` is a first-class entity holding shared purchase metadata (merchant, date, total, GST breakdown) and references to the item records created from it.

The recently-added feed is computed in-memory from canonical item and document records. It is not a separate database table.

---

## Technology Stack

### Mobile Application

| Technology | Version | Role |
|---|---|---|
| React Native | `0.86.3` | Core mobile framework |
| Expo | `~57.0.27` | Native module integration and build tooling |
| Expo Router | `~57.0.25` | File-based typed navigation |
| TypeScript | `~6.0.3` | Static type safety |
| NativeWind | `^4.2.7` | Tailwind CSS utility classes in React Native |
| Zustand | `^5.0.3` | Modular state management with persistence |
| AsyncStorage | `^2.1.2` | Local state persistence |
| React Native Reanimated | `4.5.1` | Animations |

### Backend and Database

| Technology | Role |
|---|---|
| Supabase / PostgreSQL | Managed relational database with Row Level Security |
| Supabase Auth | Email/password authentication and JWT session management |
| Supabase Edge Functions (Deno) | `scan-receipt` (AI extraction) and `delete-account` (account purge) |

### File and Image Storage

| Technology | Role |
|---|---|
| Supabase Storage | Three private buckets: `item-images`, `item-documents`, `vault-documents` |
| expo-image-manipulator | Client-side image resizing before upload |
| expo-image-picker | Camera capture and gallery selection |
| expo-document-picker | PDF and file document selection |
| expo-file-system | Local file operations and URI resolution |

### Receipt and Document Processing

| Technology | Role |
|---|---|
| Google Gemini (multimodal) | Server-side document parsing via Edge Function |
| Node.js receipt-server | Local development proxy for Gemini API calls |

### Notifications

| Technology | Role |
|---|---|
| expo-notifications `~57.0.22` | Local device notification scheduling only |

> Remote push notifications (APNs / FCM) are not currently implemented.

### Build and Release

| Tool | Role |
|---|---|
| EAS (Expo Application Services) | Cloud builds — preview APK and production AAB |

---

## Getting Started

### Prerequisites

- **Node.js** 18 or later
- **npm** (bundled with Node.js)
- A **Supabase project** (free tier is sufficient for development)
- An **Android device or emulator** (iOS simulator also supported on macOS)

### 1. Clone and Install

```bash
git clone https://github.com/its-anuraj/Keepr.git
cd Keepr
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your Supabase credentials:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
EXPO_PUBLIC_SUPABASE_KEY=your-anon-key-here

# Optional: local receipt scanning server (development only)
EXPO_PUBLIC_BACKEND_SCAN_URL=http://localhost:3001/api/scan-receipt
```

Use only the **anon key** in the client. Never place the service-role key in `.env` or any file that reaches the device.

### 3. Configure Supabase

#### Apply database migrations

Open the SQL Editor in your Supabase dashboard and run the migration files in order:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_documents_vault_schema.sql
supabase/migrations/003_production_readiness.sql
supabase/migrations/004_fix_storage_rls.sql
supabase/migrations/005_enforce_storage_security.sql
supabase/migrations/006_reconcile_live_database.sql
supabase/migrations/007_extend_maintenance_records.sql
supabase/migrations/008_service_repair_unlinked_support.sql
supabase/migrations/009_item_image_storage_path.sql
```

Or with the Supabase CLI:

```bash
supabase db push
```

#### Deploy Edge Functions

```bash
supabase functions deploy scan-receipt
supabase functions deploy delete-account
```

#### Set Edge Function secrets

In the Supabase dashboard under **Project Settings -> Edge Functions -> Secrets**, or via the CLI:

```bash
supabase secrets set GEMINI_API_KEY=your-gemini-api-key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

These keys are stored in the Supabase Secret Vault and are never accessible to the mobile client.

### 4. Start the Development Server

```bash
npx expo start

# Open directly on Android emulator or connected device
npm run android

# Optional: start local receipt scanning proxy
npm run server:receipt
```

The local receipt server requires `GEMINI_API_KEY` set in `server/.env` (not committed to version control).

> **For local notifications on Android:** Use a native development build — `npx expo run:android` — instead of Expo Go.

---

## Environment Variables

| Variable | Scope | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Client | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Client | Supabase anon (publishable) key |
| `EXPO_PUBLIC_SUPABASE_KEY` | Client | Alias for anon key (both are read by the client) |
| `EXPO_PUBLIC_BACKEND_SCAN_URL` | Client | Local Node.js receipt proxy URL (development only) |
| `GEMINI_API_KEY` | **Server-side only** | Google Gemini API key — Supabase Vault secret, never in client |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-side only** | Service-role key — Supabase Vault secret, never in client |

`.env` and `server/.env` are excluded from version control by `.gitignore`. Only `.env.example` is committed.

---

## Project Structure

```
keepr/
+-- app/                          # Expo Router screens and navigation
|   +-- (auth)/                   # Login, signup, forgot-password, reset-password, welcome
|   +-- (tabs)/                   # Bottom tabs: Vault, Items, Documents, Services, Profile
|   +-- document/                 # Document detail ([id].tsx) and add document (add.tsx)
|   +-- item/                     # Item detail view ([id].tsx)
|   +-- modals/                   # Add expense (add-expense.tsx), add maintenance (add-maintenance.tsx)
|   +-- scan-receipt/             # Receipt capture, classification, and review workflow
|   +-- service/                  # Service record detail ([id].tsx) and add service (add.tsx)
|   +-- _layout.tsx               # Root navigation layout and auth gate
+-- src/
|   +-- components/               # Reusable UI: cards, gauges, modals, scanner widgets
|   +-- constants/                # Theme tokens, item categories, app-wide constants
|   +-- hooks/                    # useResolvedImage - signed URL resolution with memory cache
|   +-- lib/                      # Supabase client (supabase.ts), report generator
|   +-- services/                 # Business logic
|   |   +-- cloudSyncService.ts   # Supabase upsert/delete operations
|   |   +-- syncQueueService.ts   # Offline queue with retry and idempotency
|   |   +-- notifications.ts      # Local notification scheduling and reconciliation
|   |   +-- storageService.ts     # Private bucket uploads and signed URL generation
|   |   +-- receiptScanner.ts     # Client-side scanner entry point
|   |   +-- geminiReceiptService.ts  # Gemini response parsing
|   |   +-- receiptParser.ts      # Extraction normalization and entity routing
|   |   +-- vaultRowMappers.ts    # Database row <-> domain type mapping
|   |   +-- ...                   # Classification, duplicate detection, migration services
|   +-- store/                    # Zustand stores: itemStore, authStore, receiptSessionStore
|   +-- types/                    # TypeScript domain models (Item, VaultDocument, MaintenanceRecord, etc.)
|   +-- utils/                    # Warranty calculations, currency formatting, storage utilities
+-- supabase/
|   +-- functions/
|   |   +-- scan-receipt/         # Deno Edge Function: Gemini multimodal receipt parsing
|   |   +-- delete-account/       # Deno Edge Function: authenticated account purge
|   +-- migrations/               # 9 sequential SQL migrations (schema, RLS, storage policies)
+-- server/
|   +-- receipt-server.js         # Local Node.js Gemini proxy (development only)
+-- test/
|   +-- benchmark_harness.js      # In-process performance harness (search, sort, feed merge)
|   +-- benchmark_harness.ts      # TypeScript source of the above
|   +-- receipt-corpus/           # Ground-truth JSON corpus for scanner evaluation
|   +-- *.ts                      # Feature-level validation scripts
+-- assets/                       # App icon, splash screen, adaptive icon layers
+-- .env.example                  # Environment variable template (committed)
+-- app.json                      # Expo app configuration
+-- eas.json                      # EAS build profiles
+-- package.json                  # Dependencies and npm scripts
+-- LICENSE                       # Proprietary software license
```

---

## Testing and Quality

### TypeScript Compilation

```bash
npx tsc --noEmit
```

Runs the TypeScript compiler in check-only mode across all screens, stores, services, and type definitions. Exits with code 0 on a clean build.

*Last verified result: exit code 0.*

### In-Memory Algorithm Benchmark

```bash
node test/benchmark_harness.js
```

Validates execution performance for full-text catalog search, multi-criteria sorting, and recently-added feed construction against synthetic in-memory datasets of 500–1,000 entities.

The harness also includes an end-to-end receipt extraction test that calls a live backend with real receipt images. This portion requires test images placed in `scratch/test-receipts/` (a `.gitignore`'d directory not committed to the repository) and a configured `BACKEND_URL`. Without those files, the extraction tests skip and report N/A.

### Feature Validation Scripts

| Script | Behavior Validated |
|---|---|
| `filter_validation.ts` | Category and warranty status filter logic |
| `data_integrity_validation.ts` | Store consistency and entity relationships |
| `storage_persistence_validation.ts` | Local and cloud storage path resolution |
| `document_thumbnail_resolution_validation.ts` | Document image retrieval pipeline |
| `item_thumbnail_pipeline_validation.ts` | Item image signed URL resolution |
| `add_item_reset_flow_validation.ts` | Add-item form reset and draft behavior |
| `cross_device_consistency_validation.ts` | Sync queue and cloud hydration behavior |
| `photo_duplicate_prevention_validation.ts` | Duplicate photo detection on upload |
| `auto_scan_gallery_flow_validation.ts` | Gallery-picker to scan workflow |

These scripts validate logic in isolation. They do not run on a physical device and do not substitute for manual end-to-end testing on real hardware.

### EAS Builds

```bash
# Preview APK - internal distribution
eas build -p android --profile preview

# Production AAB - Google Play Store
eas build -p android --profile production
```

---

## Known Limitations

| Area | Limitation |
|---|---|
| **Local notifications on Android** | `expo-notifications` is disabled inside Expo Go on Android (SDK 53+). A native development build is required to test notification scheduling. |
| **Remote push notifications** | Not implemented. All notification scheduling is device-local only. There is no APNs or FCM integration. |
| **Offline data on app uninstall** | Data written locally during an offline session is stored in `AsyncStorage`. If the app is uninstalled before synchronization completes, those local-only records cannot be recovered. |
| **Frame-rate profiling** | FlatList virtualization is implemented on the Items screen, but 60 fps / 120 fps performance under load has not been measured on physical hardware. |
| **Receipt accuracy figures** | The benchmark corpus and ground-truth dataset exist, but extraction accuracy percentages are not published because the required test receipt images are not committed to the repository. |

---

## Roadmap

### Implemented

- Purchased item records with category-specific fields (IMEI, VIN, size, color, etc.)
- Receipt scanning and AI extraction via Google Gemini (server-side, key isolated)
- Multi-product receipt grouping into a shared purchase envelope
- Documents vault with seven category types, standalone or item-linked
- Warranty and return tracking with local notifications (30-day and 7-day warnings)
- Service and repair history (linked to items or standalone)
- Search, filter, and sort on Items and Services screens
- Recently Added feed on the Vault dashboard with incremental loading
- Local-first state with offline sync queue and idempotent retry
- Private cloud storage with user-scoped signed URL access
- Row Level Security on all database tables
- Authenticated account deletion via Edge Function
- EAS build configuration for preview APK and production AAB

### Possible Future Work

- iOS App Store submission
- Remote push notifications (APNs / FCM)
- Document expiry reminders (insurance renewal, PUC, subscriptions)
- Bulk item import
- CSV or PDF ownership report export
- Shared vault records (family or household use)

---

## License

Copyright (c) 2026 Anuraj Singh. All rights reserved.

This software is proprietary. Copying, modifying, redistributing, sublicensing, selling, publishing, or creating derivative works is strictly prohibited without prior written permission from the copyright holder.

See the [LICENSE](./LICENSE) file for complete licensing terms.

---

## Author

**Anuraj Singh** — [github.com/its-anuraj](https://github.com/its-anuraj)

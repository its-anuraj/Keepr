# Keepr

A digital ownership and document management vault for keeping track of purchased products, receipts, warranties, returns, and important ownership records.

---

## Overview

Consumers regularly purchase valuable electronics, appliances, vehicles, and home goods, but critical post-purchase information quickly becomes fragmented or lost:

- Purchase dates, acquisition costs, and seller/merchant details
- Receipts, invoices, and proof-of-purchase documents
- Return windows and deadline reminders
- Manufacturer and extended warranty terms
- Vehicle registrations, service logs, and insurance documents
- Utility bills, fee receipts, and municipal records

**Keepr** solves this problem by providing a unified, secure, local-first digital ownership vault. It organizes user assets into distinct, structured records:

- **Purchased Items**: Tangible products with acquisition details, product images, warranty timelines, and cost-of-ownership tracking.
- **Documents**: Standalone or item-linked records across specialized categories (invoices, vehicle registrations, warranties, utility bills).
- **Recently Added**: A unified, high-performance mixed presentation feed reflecting recent vault activity.
- **Proactive Reminders**: Local scheduling for upcoming return deadlines, warranty expirations, and scheduled maintenance.
- **Fast Search & Filter**: Real-time multi-field search and category filtering across the entire catalog.

---

## Key Features

### Authentication & Account Security
- **Supabase Authentication**: Email/password registration, secure login, and session persistence using `AsyncStorage`.
- **Password Reset**: Automated password recovery flow via email links.
- **Account Deletion**: Server-side authenticated account deletion through a Supabase Edge Function (`delete-account`), purging user records and authentication data in compliance with privacy guidelines.

### Purchased Items Management
- **Detailed Asset Records**: Tracks product title, category, brand, model number, serial number, purchase date, acquisition price, and merchant.
- **Visual Assets**: Photo capture and gallery picker with image optimization (`expo-image-manipulator`).
- **Warranty Tracking**: Visual warranty progress gauge calculating elapsed duration and remaining days.
- **Total Cost of Ownership (TCO)**: Aggregates initial acquisition price with logged maintenance and upkeep expenses.
- **Return Tracking**: Return window tracking with proactive deadline alerts.

### Receipt Scanning & Classification
- **Server-Side AI Pipeline**: Scans purchase receipts and invoices via Google Gemini through a dedicated server-side architecture (Supabase Edge Function or Node.js proxy), preventing client-side API credential exposure.
- **Structured Extraction**: Extracts merchant name, transaction date, currency, line items, taxes, and total amounts.
- **Multi-Product Purchases**: A single receipt containing multiple items is parsed into a grouped purchase with discrete item lines rather than creating disjointed, disconnected records.
- **Interactive Review**: Users review, edit, and confirm extracted fields before committing them to the vault.
- **Dual Deployment Options**: Supports Supabase Edge Functions in production and a local Node.js server (`server/receipt-server.js`) for development.

### Documents Vault
- **Specialized Categorization**:
  - Receipts & Invoices
  - Vehicle Documents (registration, insurance, inspection)
  - Warranty & Guarantee Certificates
  - Fees & Payments
  - Bills & Utilities
  - Ownership & Purchase Agreements
  - Other Important Documents
- **Relational Flexibility**: Documents can exist independently (e.g., utility bills, tax records) or be linked to a specific Purchased Item (e.g., item invoice, extended warranty certificate).

### Multi-Product Purchases
A single receipt or invoice containing multiple distinct products is structured as one grouped purchase event with individual item lines. This preserves the transactional context (shared date, seller, receipt attachment) while allowing each purchased item to have its own category, serial number, and warranty lifecycle.

### Search, Filter & Sort
- **Multi-Field Search**: Real-time substring matching across item names, merchants, serial numbers, categories, and notes.
- **Filter Modals**: Granular filtering by category and warranty status (`Active`, `Expiring Soon`, `Expired`).
- **Multi-Criteria Sorting**: Sort by acquisition date (newest/oldest), price (high-to-low / low-to-high), and alphabetical order.
- **Recently Added Feed**: Unified chronological presentation combining items and documents into a cohesive activity view.

### Reminders & Notifications
- **Deterministic Scheduling**: Proactive local notifications for warranty expiration (30-day and 7-day warnings), return window deadlines, and scheduled maintenance.
- **Local-Only Architecture**: Leverages `expo-notifications` for device-local scheduling without requiring external push services.
- **Reconciliation Engine**: Automatic cancellation and rescheduling when item details or maintenance dates are modified.

### Offline-First Architecture & Sync Queue
- **Local-First State**: Zustand stores backed by `AsyncStorage` ensure all read and write interactions complete immediately without network latency.
- **Durable Sync Queue**: Network mutations are enqueued in `syncQueueService` with deterministic operation keys (`op-${entityType}-${entityId}-${operation}`).
- **Automatic Retry**: The queue retries failed operations upon network reconnection, app launch, or user session restoration.
- **User-Scoped Isolation**: Sync queue state is isolated per user ID to prevent data leakage across account switches.
- **Known Limitation**: Local data that has not yet synchronized with the cloud backend will be lost if the application is uninstalled before synchronization completes.

---

## Security Architecture

Keepr enforces strict data protection and credential isolation standards:

```
┌────────────────────────────────────────────────────────┐
│                   Mobile Client                        │
│   • Expo / React Native UI                             │
│   • Zustand Local State (AsyncStorage)                 │
│   • Anon Key only (No service-role access)             │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS / JWT
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Supabase Cloud                       │
│   • Row Level Security (RLS) on all PostgreSQL tables  │
│   • Private Storage Buckets (item-images, documents)   │
│   • User-scoped Storage Paths: /{userId}/*             │
└───────────────┬───────────────────────────┬────────────┘
                │                           │
                ▼                           ▼
┌──────────────────────────────┐ ┌───────────────────────┐
│ Edge Function: scan-receipt  │ │ Edge: delete-account  │
│ • Reads GEMINI_API_KEY from  │ │ • Reads SERVICE_ROLE  │
│   Supabase Secret Vault      │ │   from Secret Vault   │
│ • Client never sees API keys │ │ • Purges user data    │
└──────────────────────────────┘ └───────────────────────┘
```

- **Row Level Security (RLS)**: Every database table (`items`, `documents`, `maintenance_logs`, `expense_logs`) enforces `auth.uid() = user_id` for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.
- **Private Storage Buckets**: Supabase Storage buckets (`item-images`, `item-documents`) are strictly private. Access requires valid user session tokens, and bucket policies restrict access to files located within the user's specific directory prefix (`{userId}/*`).
- **Server-Side Credential Isolation**: The Google Gemini API key (`GEMINI_API_KEY`) and Supabase Service Role key (`SUPABASE_SERVICE_ROLE_KEY`) are exclusively stored in server environment variables / Supabase Secret Vault. Neither key is ever bundled into the client application.
- **Authenticated Edge Functions**: Server functions verify the caller's JWT before executing privileged operations such as AI processing or account termination.
- **No Unverifiable Claims**: Security is achieved through industry-standard architectural separation, authenticated protocols, and database-level authorization.

---

## Tech Stack

| Layer | Technology | Description |
|---|---|---|
| **Frontend Framework** | React Native `0.86.3` / Expo `~57.0.23` | Cross-platform native mobile foundation |
| **Navigation** | Expo Router `~57.0.0` | File-based typed routing architecture |
| **Language** | TypeScript `~5.8.2` | Strict compile-time type safety across the entire codebase |
| **Styling** | NativeWind `^4.2.7` / Tailwind CSS `^3.4.19` | Utility-first responsive component styling |
| **State Management** | Zustand `^5.0.3` | Lightweight modular state with `AsyncStorage` persistence |
| **Backend & Database** | Supabase / PostgreSQL | Managed relational database with Row Level Security |
| **Cloud Functions** | Supabase Edge Functions (Deno) | Authenticated serverless execution for AI scanning & account deletion |
| **AI / OCR Engine** | Google Gemini | Multimodal document parsing executed securely server-side |
| **Cloud Storage** | Supabase Storage | Encrypted private storage for photos and PDF/image documents |
| **Notifications** | Expo Notifications `~57.0.0` | Deterministic local device notification scheduling |
| **Build & Release** | EAS (Expo Application Services) | Cloud-based preview APK and production AAB compilation |

---

## Architecture

The diagram below illustrates the relationship between client-side components and server-side cloud services:

```
[ User Interaction ]
         │
         ▼
[ React Native / Expo UI ]
  ├── App Screens (app/)
  ├── Reusable Components (src/components/)
  └── Modals & Workflows
         │
         ▼
[ Zustand State Stores ] ──(Local Cache)──► [ AsyncStorage ]
  ├── itemStore
  ├── authStore
  └── receiptSessionStore
         │
         ▼
[ Offline Sync Queue ] ──(Deterministic Op IDs)──► [ syncQueueService ]
         │
         ├──(Online Sync)──► [ Supabase PostgreSQL + RLS ]
         │                   ├── items
         │                   ├── documents
         │                   └── maintenance_logs
         │
         ├──(File Upload)──► [ Supabase Storage (Private) ]
         │                   ├── item-images/{userId}/*
         │                   └── item-documents/{userId}/*
         │
         └──(AI Processing)─► [ Supabase Edge Function ]
                             └── Gemini Vision API (Protected Key)
```

---

## Data Model & Entity Routing

Keepr implements a strict separation of concerns between its two primary data entities:

```
┌──────────────────────────────────────┐       ┌──────────────────────────────────────┐
│            PURCHASED_ITEM            │       │               DOCUMENT               │
├──────────────────────────────────────┤       ├──────────────────────────────────────┤
│ • id (UUID)                          │       │ • id (UUID)                          │
│ • title, brand, model, serial_number │       │ • title, category, document_type     │
│ • price, purchase_date, merchant     │◄──┐   │ • file_url, file_name, file_size     │
│ • category, image_url                │   └───│ • item_id (Optional foreign key)     │
│ • return_deadline, warranty_expiry   │       │ • expiry_date, notes                 │
│ • user_id (RLS boundary)             │       │ • user_id (RLS boundary)             │
└──────────────────────────────────────┘       └──────────────────────────────────────┘
```

1. **`PURCHASED_ITEM`**: Represents physical assets acquired by the user. Owns warranty gauges, total cost of ownership calculations, and return deadline workflows.
2. **`DOCUMENT`**: Represents physical or digital paperwork (receipts, contracts, registrations, certificates). A document may reference an item via `item_id`, but linking a document to an item does **not** convert the document into an item.
3. **`Recently Added`**: A high-performance, dynamic in-memory merge feed derived from canonical item and document records. It is **not** a separate database entity, preventing data duplication and synchronization divergence.

---

## Engineering Highlights

- **Virtualized List Rendering**: The Items screen (`app/(tabs)/items.tsx`) utilizes React Native `FlatList` with `initialNumToRender={10}`, `maxToRenderPerBatch={10}`, and `windowSize={5}` to maintain constant memory overhead at 500+ items.
- **Memoized Component Hierarchy**: Asset cards (`ItemCard`) and Document tiles (`DocumentTile`) are wrapped in `React.memo` to eliminate unnecessary re-renders during search input changes and sorting toggles.
- **Deterministic Sync Queue**: Mutation operations generate deterministic keys (`op-${entityType}-${entityId}-${operation}`) ensuring idempotent retries and preventing duplicate records during network fluctuations.
- **Idempotent Upserts**: Cloud synchronization calls use Supabase `upsert` semantics with explicit conflict resolution on primary keys (`id`).
- **User-Scoped Queue State**: Sync queue persistence keys are namespaced by the authenticated user's ID, guaranteeing zero cross-account data leakage on shared devices.
- **Deterministic Notification Identifiers**: Local notification IDs are computed deterministically (e.g., `maint-${itemId}-${index}-${timestamp}`), allowing targeted cancellation and preventing phantom notification duplicates.
- **Multi-Product Purchase Grouping**: Receipts containing multiple line items are recognized as a composite purchase event, preserving individual item details under a unified transaction envelope.
- **Comprehensive Type Safety**: The codebase operates under strict TypeScript configuration with zero `any` emissions in application domain models.

---

## Performance

The application data operations and in-memory algorithms were verified through the project benchmark suite (`test/benchmark_harness.ts`):

| Operation | Benchmark Conditions | Measurement | Status |
|---|---|---|---|
| **Full-Text Catalog Search** | 500 in-memory items (title, merchant, serial) | `< 1.0 ms` | Verified |
| **Multi-Criteria Sorting** | 500 items (Price, Date, Alphabetical) | `< 1.0 ms` | Verified |
| **Recently Added Feed Merge** | 1,000 entities (500 items + 500 documents) | `~1.5 ms` | Verified |
| **List Virtualization** | Items collection screen (`FlatList`) | Bounded allocation | Implemented |

> **Note on Device Profiling**: List virtualization is implemented for the Items screen; frame-level Android device profiling remains a release-validation task on physical target devices.

---

## Testing & Quality Assurance

The codebase includes automated static verification and benchmark test harnesses:

1. **Static Type Verification**:
   ```bash
   npx tsc --noEmit
   ```
   *Result*: Exits with code 0 (clean compilation across all screens, stores, and services).

2. **Algorithmic Benchmark Harness**:
   ```bash
   node test/benchmark_harness.js
   ```
   *Result*: Validates sub-millisecond execution for search, sort, and entity-merging algorithms.

3. **Receipt Processing Corpus**:
   - `test/receipt-corpus/ground_truth.json`: Structured ground truth corpus containing multi-product and single-product receipt samples used to evaluate parser accuracy and edge cases.

---

## Known Limitations

- **Physical Device Frame Profiling**: Frame-rate validation (confirming 60fps/120fps under stress) requires a physical Android device build and has not been performed in an automated headless environment.
- **Remote Push Notifications**: Currently, all notifications are scheduled device-locally via `expo-notifications`. Remote server-triggered push notification infrastructure (e.g., APNs / FCM push relays) is not currently implemented.
- **Unsynced Offline Data on App Uninstall**: Data created locally during offline usage is stored in device `AsyncStorage`. If a user uninstalls the application before connecting to the internet, unsynchronized local-only records cannot be recovered.

---

## Project Structure

```
keepr/
├── app/                           # Expo Router screens & navigation layouts
│   ├── (auth)/                    # Authentication screens (login, signup, reset)
│   ├── (tabs)/                    # Main bottom navigation tabs (home, items, documents, profile)
│   ├── document/                  # Document detail and creation views
│   ├── item/                      # Item detail and management views
│   ├── modals/                    # Creation and configuration modals
│   └── scan-receipt/              # Receipt camera, upload, and review workflows
├── src/                           # Application core domain logic
│   ├── components/                # Reusable UI components (cards, gauges, modals)
│   ├── constants/                 # Theme tokens, categories, routes
│   ├── lib/                       # Supabase client and utility helpers
│   ├── services/                  # Business logic (sync, notifications, scanner, auth)
│   ├── store/                     # Zustand state management stores
│   ├── types/                     # TypeScript domain models and interface declarations
│   └── utils/                     # Formatting, currency, and warranty calculations
├── supabase/                      # Backend infrastructure
│   ├── functions/                 # Deno Edge Functions (scan-receipt, delete-account)
│   └── migrations/                # SQL migrations with schema, RLS policies, and triggers
├── server/                        # Local Node.js receipt scanning proxy for development
├── test/                          # Performance benchmark harness and receipt ground truth
├── assets/                        # Brand icons, splash screens, and image assets
├── LICENSE                        # Proprietary software license
└── package.json                   # Project metadata and dependencies
```

---

## Getting Started

### Prerequisites
- Node.js (version 18 or later recommended)
- npm or yarn
- Expo CLI (`npx expo`)

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Create a `.env` file in the project root based on `.env.example`:

```env
# Required for Supabase Cloud integration (optional for local offline mode)
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# Optional: Local development receipt scanner URL
EXPO_PUBLIC_BACKEND_SCAN_URL=http://localhost:3001/api/scan-receipt
```

*(Note: Keepr operates in full offline vault mode if no Supabase credentials are provided.)*

### 3. Local Development Server
```bash
# Start Expo development server
npx expo start

# Run on Android emulator or connected device
npm run android

# Start the optional local receipt scanning server (requires GEMINI_API_KEY in server/.env)
npm run server:receipt
```

---

## Production & Deployment

Keepr is configured for build automation via Expo Application Services (EAS):

```bash
# Build Android preview APK for physical device testing
eas build -p android --profile preview

# Build Android App Bundle (AAB) for Google Play Store distribution
eas build -p android --profile production
```

- **Preview Profile**: Generates an installable `.apk` binary for rapid staging and hardware verification.
- **Production Profile**: Compiles an optimized, signed `.aab` package formatted for Google Play Store publication.

---

## Screenshots

> *Application interface captures and workflow walkthroughs are available in the project documentation directory or can be captured via connected emulator sessions.*

---

## Author

**Anuraj Singh**

---

## License

Copyright (c) 2026 Anuraj Singh. All rights reserved.

This software is proprietary. Copying, modifying, redistributing, sublicensing, selling, publishing, or creating derivative works is strictly prohibited without prior written permission from the copyright holder.

See the [LICENSE](./LICENSE) file for complete licensing terms.

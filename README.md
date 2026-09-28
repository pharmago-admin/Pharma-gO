# 💊 PharmaGo — online medicine delivery (MVP)

Static frontend (`index.html`, GitHub Pages) + Google Apps Script backend (`code.gs`) that uses
**Google Sheets as the database** and **Google Drive as file storage**.

| Piece | File | Where it runs |
|---|---|---|
| API / business logic | `code.gs` | Google Apps Script, deployed as a Web App |
| App UI | `index.html` | GitHub Pages (or any static host) |
| Data | Sheets: `Users`, `Prescriptions`, `Merchants`, `Medicines`, `Otps` | your Google Drive |
| Files | Drive folders: Pending / Approved / Declined Rx + vendor KYC docs | your Google Drive |

---

## Deploy in 10 minutes

1. **Spreadsheet** — create one, copy its ID from the URL, set it as `SHEET_ID` in `code.gs`
   (or as a Script Property — see [Configuration](#configuration)).
2. **Drive folders** — create three folders for prescriptions (pending / approved / declined) and
   paste their IDs into `PENDING_FOLDER_ID`, `APPROVED_FOLDER_ID`, `DECLINED_FOLDER_ID`, and
   `MERCHANT_DOCS_FOLDER_ID` (or set them as Script Properties).
3. **Apps Script** — *Extensions → Apps Script*, paste `code.gs`, then
   **Deploy → New deployment → Web app**
   *Execute as: **Me*** · *Who has access: **Anyone*** → copy the `/exec` URL.
4. **Frontend** — paste that `/exec` URL into `API_URL` at the top of the `<script>` in `index.html`,
   then publish the file with GitHub Pages (or open it locally).
5. **(optional)** Set the `FRONTEND_URL` Script Property to your Pages URL so emailed
   “set password” links land on your site. Left blank, Apps Script serves its own
   set-password form, so the link always works.

> ### ⚠️ The #1 gotcha
> Editing `code.gs` in the editor does **not** change the live `/exec` URL. After every edit go to
> **Deploy → Manage deployments → ✏️ Edit → Version: _New version_ → Deploy**.
> If the UI behaves like an older build, this is almost always why.

---

## Configuration

Every value below can be set as a **Script Property** (*Project settings → Script properties*),
which overrides the constant in `code.gs` — handy for keeping secrets out of Git.

| Key | Default | Purpose |
|---|---|---|
| `SHEET_ID` | *(in file)* | Target spreadsheet |
| `PENDING_FOLDER_ID` / `APPROVED_FOLDER_ID` / `DECLINED_FOLDER_ID` | *(in file)* | Prescription folders |
| `MERCHANT_DOCS_FOLDER_ID` | *(in file)* | Vendor-document folder |
| `ADMIN_KEY` | `2026` | **Change this.** Unlocks admin actions |
| `ADMIN_GOOGLE_DOMAIN` | blank | Optional hardening: privileged requests must also come from a Google account in this domain (see note below) |
| `FRONTEND_URL` | blank → Apps-Script-hosted set-password page | Emailed link target |
| `GOOGLE_CLIENT_ID` | `644669603326-i5uuu2lfobqadgmggpnhticbeel4ioef.apps.googleusercontent.com` | OAuth client ID (Web) whose audience is checked against Google sign-in tokens |

Google sign-in is preconfigured in `index.html` and `code.gs`; keep their `GOOGLE_CLIENT_ID`
values in sync if you change it. A Script Property can override the backend value, but the browser
still uses the ID in `index.html`. Apps Script will ask for the `script.external_request` scope on
the next deploy (used to verify tokens server-side). Clearing the ID keeps every other sign-in
method working.

---

## Flows at a glance

* **Customer** — register → 6-digit email code → (set password now, or by emailed link) → log in →
  upload prescription → preview the file and track status. An approved prescription can place an
  order for a catalogue medicine; the pharmacy accepts or declines it and is emailed either way.
* **Sign-in options** — the account card mirrors the familiar ePharmacy-style layout:
  password + **Remember me?**, **Login with Google**, and
  **“Email me a one-time code instead”** (a 6-digit code lands in the inbox — no password needed;
  entering it also finishes email verification for a pending customer). The Google token is
  verified server-side (`code.gs` calls Google directly); a first social sign-in creates an ACTIVE
  customer and later ones reuse the account with that email.
* **Vendor** — register with GST + Drug License + Shop ID + PAN → email code → admin reviews the
  documents → approved vendor logs in and lists medicines (own listings only).
* **Admin** — unlock with the admin key → open each prescription in the same viewer the patient uses,
  then approve/decline (the file is moved between the Pending/Approved/Declined folders and approved
  files are renamed `UserID__UploadedTime`), approve/decline vendors, list users, add medicines.
  From the users table, **Prescriptions** filters the review queue to that person.

---

## Tests

Install the UI test dependency first. The backend runs against a mocked Apps Script runtime:

```bash
npm install
npm test              # backend end-to-end + frontend wiring + 115 browser-like UI-state checks
npm run test:api      # 27 scenarios / 331 checks against code.gs
npm run test:frontend # index.html wiring, AA-contrast guard + UI-state checks
```

Real-pixel verification (optional — needs a browser binary, kept out of git):

```bash
npx playwright install chromium --with-deps   # one-time, ~150 MB
npm run test:visual                           # boots the demo, screenshots every workspace
```

`tests/visual-smoke.js` drives guest → customer → viewer → catalogue → admin in Chromium,
saves six screenshots to `tests/screenshots/` (git-ignored) and fails on any console or page
error. It also asserts the focus trap and the `/` catalogue shortcut behave in a real browser.

### Interface

`index.html` ships the **Aurora** UI: airy white surfaces on a `#f7f7fd` page with a pastel gradient
wash, an indigo accent (`#4f46e5`), pill controls and generously rounded, softly layered cards.
Inter carries prose and headings; IBM Plex Mono is reserved for identifiers, prices and counters.

* **Glass rail** — `.sidebar` is a floating, blurred, fully rounded panel: brand mark, the five
  `data-show` tabs (`.tabs`), the session chip (`#sessionBar`), sign-out and the connection pill.
  The open tab is a gradient pill with `aria-current="page"`. Below 1040 px the rail becomes a
  floating bottom dock; below 640 px it turns icon-only, which is why every tab also carries an
  `aria-label` (and the pharmacy tab keeps its icon when it is relabelled).
* **Workspace header** — the sticky topbar is glass as well. It names the current space (`Guest /
  Customer / Pharmacy workspace`, `Admin unlocked`) and the active tab, with quick actions for
  uploading a prescription and opening the catalogue. `syncTopbar()` keeps it in step with
  `applyAuthUI()`.
* **Ambient aurora** — one `aria-hidden` fixed layer holds three slowly drifting, blurred orbs on top
  of soft page gradients. It is dropped below 640 px and under `prefers-reduced-motion`, and it never
  sits above the interface (`.app-shell` owns a higher stacking context).
* **Command bar** — the catalogue search is a pill filter bar with live results, above a table with
  sticky uppercase headers, airy rows and right-aligned tabular numerics.
* **Cards over tables for state** — prescriptions and orders render as `rx-card` tiles with a status
  chip and a three-step review track (Uploaded → In review → Approved/Declined); the screen-reader
  table (`#historyTbl`) stays in sync. Admin overview tiles carry tinted icon badges and a soft
  corner glow.
* **Viewer** — `#rxViewer` is a full modal (34 px radius over a blurred backdrop) with sticky
  header/footer actions, inline image and PDF preview, download, Drive fallback and admin
  approve/decline.
* **Accessibility** — every text token meets WCAG AA (4.5:1) against the surface it is painted on,
  and `npm run test:frontend` now reads those pairs straight out of the `:root` palette, so a
  re-theme is checked rather than assumed. The prescription viewer is a real dialog: `aria-modal`,
  focus trapped with Tab/Shift+Tab, Escape to close, focus returned to the control that opened it.
  Empty and loading states are explicit for every queue.
* Design tokens live in one `:root` block (colour, shape, elevation, easing), so re-theming stays a
  token edit; motion is disabled under `prefers-reduced-motion` and the rail/topbar/hero are dropped
  in print.

Every surface shares the same palette. The pages Apps Script serves itself
(`pageShell_()` + `auroraCss_()` in `code.gs`) render the emailed set-password form, the form-post
result and the `FRONTEND_URL` hand-off in the Aurora chrome — the same glass card, gradient brand
mark, indigo pill button and drifting aurora layer. `demo/server.js` themes its hint bar and the
`/__mailbox` page with the same tokens, and `npm run test:api` asserts that no surface falls back to
clinical blue.

### Emails and admin hardening

Every outgoing mail now carries a branded `htmlBody` (inline styles + tables, plain text kept as
the fallback): the OTP mail shows the code as a large mono block on the brand tint, the reset mail
gets a real indigo pill CTA with a link fallback, and review/order notifications link back to the
app. Mail clients are conservative, so the template uses solid colours and a table layout — no
gradients, no external CSS. `emailHtml_()` escapes everything, and a spec scenario asserts the
palette (and the absence of the old clinical blue) on every branded surface.

Setting the `ADMIN_GOOGLE_DOMAIN` Script Property adds a second factor to the admin key: the Google
account serving the request must be in that domain. With the default blank value behaviour is
unchanged, and `tests/spec.js` has a scenario for both branches. Note that a web app deployed as
*Execute as: me* always reports the **owner's** account, so the gate only distinguishes callers once
the deployment is switched to *Execute as: user accessing the web app*.

### UI states

`index.html` uses `data-show` and `applyAuthUI()` to separate the workspaces:

| Mode | Navigation | Workspace |
|---|---|---|
| Guest | Account, catalogue, pharmacy registration, admin | Sign up / OTP / password reset; browse medicines; register a pharmacy; enter admin key |
| Customer | Prescriptions, catalogue, admin | Upload, view and track personal prescriptions |
| Pharmacy | Catalogue, My shop, admin | Add, edit, delist and relist own medicines (password confirmed for writes) |
| Admin unlocked | Admin tab alongside any role | Overview counts, view/review prescriptions, KYC links, users and catalogue editing |

The admin key can be unlocked and locked separately from customer/pharmacy sign-in.
Changing roles automatically moves away from a now-hidden tab. Visibility is **not**
a security boundary: the Apps Script backend must still verify privileged requests.
`npm run test:frontend` checks ids, handler wiring, the state vocabulary and all
five tab rules, then drives 115 UI-state checks with jsdom (including the icon rail,
workspace header and `aria-current` state).
Customers and admins open the same prescription viewer (`view_rx`): the owner or
the admin key is required, and the file is shown in the page (images and PDFs)
with a Drive fallback for older deployments.

### Interactive demo

```bash
PORT=8000 node demo/server.js
```

Visit `http://localhost:8000` locally (or use the live preview in Arena). The demo
runs **the actual `code.gs`** against an in-memory Apps Script stub. It does not
connect to the live spreadsheet, send email or store real patient information.
Sample customer: `demo@pharmago.test` / `demo123`; sample approved pharmacy:
`vendor@pharmago.test` / `demo123`; demo admin key: `changeme-admin-key`.
Newly registered users can use the verification code shown on the page or in
`/__mailbox`. The seeded customer has a pending sample prescription and an
approved follow-up — both can be opened from **My prescriptions** and from the
admin review queue. A second pharmacy (Valley Medicos) is awaiting admin approval.
Demo data resets on server restart. The demo serves its API at a same-origin `/api` path;
the published static `index.html` continues to use the configured Apps Script URL.

Customer IDs now increment within the script's calendar year (`U-2026-0010`,
`U-2026-0011`, …). The allocator scans existing IDs (including after legacy rows
or deleted entries) and locks registration so concurrent sign-ups cannot reuse one.
Vendor, medicine and prescription IDs retain collision-resistant random IDs.

`tests/spec.js` drives `doPost()` exactly as the browser does (register → OTP → password-by-email →
login → upload → admin review → vendor approval → medicine listing), so a regression in any of those
flows fails the build.

---

## Audit: what was broken, and what changed

Run against the previous revision — the first four made the app unusable end to end.

| # | Sev | Symptom | Root cause | Fix |
|---|-----|---------|-----------|-----|
| 1 | 🔴 | **Nobody could ever log in.** “Forgot password?” emailed a link; opening it and setting a password returned *“No active code found”* | Token was stored under key `PWDRESET:<userId>` but looked up as `PWDRESET:<token>` — a different row, so it never matched. Even on a match, `key.split(':')[1]` returned the token, not the user id | Tokens are matched by purpose + hash (`consumeToken_`), the user id is read back from the row key, and the link is single-use (siblings are invalidated) |
| 2 | 🔴 | Emailed link opened a page stuck on *“Taking you to the set-password page…”* | `FRONTEND_URL` was the placeholder `https://USERNAME.github.io/REPO/` | Blank/placeholder ⇒ Apps Script renders its own password form (plain form POST, no CORS). Set `FRONTEND_URL` to redirect to Pages instead |
| 3 | 🔴 | Vendor registration always failed | `MERCHANT_DOCS_FOLDER_ID` was `REPLACE_WITH_…`, and KYC files used `DOMAIN_RESTRICTED` sharing, which throws on normal (non-Workspace) Google accounts | Folder is auto-created and cached in Script Properties; documents are set `PRIVATE` with a safe fallback |
| 4 | 🔴 | Approved vendor could never add a medicine — always *“Wrong merchant password.”* | `resolveStaffAuth_` compared against `Merchants.Password`, which was never written (the UI sends no password during OTP verification) | Passwords live in `Users` (the login sheet) as the single source of truth; the `Merchants` copy is kept in sync for old rows |
| 5 | 🟠 | Two sign-ups/uploads in the same millisecond shared an ID: approving one prescription moved a *different* user's file, and users saw each other's history | IDs were `prefix + Date.now()` | `newId_()` adds a random suffix for Rx/vendor/medicine IDs; customers use the locked sequential `U-YYYY-NNNN` allocator |
| 6 | 🟠 | Anyone could call `get_data` and download every user's email/phone, all prescriptions and vendor KYC file IDs | `getData` had no authorisation | Admin lists require `adminKey`; prescriptions require `userId` (scoped to that user); medicines require `merchantId`. Password hashes are never returned |
| 7 | 🟠 | Clicking a button sometimes did nothing at all | `fetch()` had no `try/catch` — CORS/network failures became unhandled rejections | `callAPI` reports network, non-JSON and HTTP failures in the on-screen message, and keeps `text/plain` so the browser sends no preflight (Apps Script cannot answer `OPTIONS`) |
| 8 | 🟠 | After verifying a vendor email, “send me a password link” appeared to do nothing | It switched to the *Forgot* view, which lives on another (hidden) tab | The tab is switched before the view; the code now also lets you set the password right on the OTP screen |
| 9 | 🟡 | A failed verification email left an account that could not be re-registered | The user row was written *before* the mail was sent | Email first: on failure nothing is created, so the visitor can just retry |
| 10 | 🟡 | Unverified or declined users could still upload prescriptions | No status check in `upload_rx` | Uploads require an `ACTIVE` account; oversized files are rejected client- and server-side |
| 11 | 🟡 | `Sheet not found … run setupSheets()` broke every request | Sheets were only created by the manual setup step | `getSheet_()` creates a missing sheet (with headers) on demand; `setupSheets()` still exists |
| 12 | 🟡 | Approving a prescription whose Drive file had been deleted showed a raw internal error | Unhandled `getFileById` exception | Clear message, status left unchanged |
| 13 | 🟡 | Vendors pending approval were told *“No password set yet”* | Credential checks ran before status checks | Status is checked first; credentials are never revealed before identity |
| 14 | 🟢 | OTP countdown ran into negative numbers (`-1:-59`) and never stopped | `setInterval` was never cleared | Timer stops and shows “Code expired” |
| 15 | 🟢 | “Uploaded At” was 5:45 off | `toISOString()` (UTC) stored in a local-timezone sheet | Timestamps use the script timezone (`Asia/Kathmandu`, see `appsscript.json`) |
| 16 | 🟢 | Invalid email → MailApp threw *after* the account was created | No validation | Email/phone validated before anything is written |

---

## Still to do before real use

* `ADMIN_KEY` is typed into the browser and kept in `sessionStorage` — fine for an MVP, but move admin
  actions behind a real Google sign-in (`Session.getActiveUser()`) before going live.
* Customer and pharmacy actions now require a 7-day session token from `login`. Passwords are stored
  as `s1$salt$hash`; older unsalted hashes still log in and are upgraded. The token lives in
  `localStorage`, which a stolen browser profile can read — httpOnly cookies need a different host.
* New prescription files are private. `view_rx` reads them as the script owner. Reviewing an older
  link-shared file locks it down. Redeploy the Apps Script web app or the live page cannot issue tokens.
* Orders connect an approved prescription to one catalogue medicine. There is no delivery tracking,
  payment, or multi-item basket yet.

### Prescription delivery details

New prescription uploads require patient name, receiver name, confirmation calling
number, receiver calling number, delivery address (house/street/ward), and
city/municipality/district. Landmark and delivery instructions are optional. Both
phone fields accept 7–15 digits with an optional country code, spaces, parentheses,
and hyphens; the same number may be entered for both contacts.

Details are saved with the prescription and shown in customer history and admin
review. The pharmacy fulfilling a placed order can see the linked delivery details
in its order queue; unrelated customers and pharmacies cannot access them. Uploading
a prescription still does not place an order.

Deploy both `index.html` and the updated Apps Script backend together. Existing
`Prescriptions` sheets automatically receive eight appended columns on setup or
first access; existing rows and file references remain unchanged. Older records
show “Delivery details were not recorded” and remain usable. New API clients must
send `patientName`, `receiverName`, `confirmationPhone`, `receiverPhone`,
`deliveryAddress`, and `deliveryCity` with `upload_rx`; optional fields are
`landmark` and `deliveryInstructions`.

### Responsive UI and motion

The prescription form groups contact, location, and optional instructions into
numbered sections, with two columns on desktop and a single column on small
screens. Phone copying, autofill hints, touch-sized buttons, dynamic-height
viewers, and scrollable admin tables support mobile use. Uploads show a busy
indicator, prevent duplicate submissions, and preserve the form after a failure.
Section entrances and delivery-detail expansion use short animations; the system
`prefers-reduced-motion` setting disables animation delays and reduces transitions.

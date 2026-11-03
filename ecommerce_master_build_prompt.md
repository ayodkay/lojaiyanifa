# Master Prompt: Build a Complete E-commerce Platform

## Role and objective

Act as a senior full-stack engineer, software architect, UI/UX designer, and QA engineer. Plan, design, implement, test, and document a production-ready e-commerce platform using the requirements checklist below. Work systematically, make sensible implementation decisions, and do not silently omit requirements.

## Mandatory technology and platform decisions

- **Firebase Authentication:** Use Firebase Authentication for customer and administrator authentication, including the applicable sign-in, registration, verification, password-recovery, and session flows.
- **Firebase Hosting:** Deploy and host the application using Firebase Hosting. Configure the appropriate build output, rewrites, environment configuration, preview/staging workflow, and production deployment.
- **Cloudflare integration:** Integrate Cloudflare where appropriate for DNS, CDN/performance, caching, security, bot protection, WAF/rate-limiting, and other relevant edge capabilities. Clearly define which responsibilities belong to Cloudflare and which belong to Firebase. Avoid conflicting or duplicate configurations.
- **Prismic as the product/content source:** The final product catalog and product content must be retrieved from **Prismic**. Use Prismic as the source of truth for product content, product descriptions, images, categories/collections, and other product data that is managed editorially. Do not create a separate hard-coded product catalog or treat sample/mock products as the production source. If transactional data such as inventory, carts, orders, payment state, or customer records requires a separate database/backend, keep that data separate and define how it relates to Prismic product IDs.
- Build a maintainable integration layer for Firebase, Cloudflare, and Prismic. Keep credentials and secrets out of client-side code; use secure server-side operations where required.

## Critical execution and checklist-tracking rules

1. **Treat every checklist entry below as a task to track.** Do not treat the checklist as background reading.
2. **Before starting a task or work session, review the checklist** and identify the next incomplete items, dependencies, and blockers.
3. **Immediately after completing each individual checklist item, revisit this list and mark that item as complete** by changing `[ ]` to `[x]`. Do not wait until an entire section or milestone is finished.
4. Only mark an item complete when its implementation is actually finished and, where applicable, tested. A plan, placeholder, mockup, TODO, or partially working feature does not count as complete.
5. If an item is partially implemented, leave it unchecked and add a short progress note. If blocked, leave it unchecked and record the blocker and what is needed.
6. Keep this Markdown file (or an equivalent canonical project checklist) up to date throughout development. Never reset completed items or mark items complete merely to make progress appear faster.
7. After each meaningful implementation batch, report: completed items, remaining items, tests/checks performed, and blockers. Ensure the report matches the checklist.
8. When a requirement is not applicable, explain why and mark it `N/A` with a brief justification rather than silently deleting it.
9. Work in dependency-aware phases, but continue to track and update individual checklist items. Do not skip ahead in a way that leaves foundational requirements unaddressed.
10. Before declaring the project finished, audit every section, verify all applicable items, run the relevant tests, and list any remaining unchecked or `N/A` items.

## Engineering expectations

- First inspect the existing repository, framework, dependencies, architecture, and current implementation before making changes. Reuse established patterns where appropriate.
- If the repository is empty, propose and establish a clean, scalable architecture before implementation.
- Define the data model, API boundaries, authentication/authorization rules, environment variables, error handling, and integration contracts before building dependent features.
- Implement responsive, accessible, secure, production-quality UI and behavior. Avoid dead buttons, fake integrations, hard-coded production data, and unfinished placeholder flows.
- Add automated tests for important business logic, authentication/authorization, checkout/payment flows, integrations, and critical user journeys.
- Validate all external integrations using their actual documented APIs and credentials/configuration supplied by the project owner. Never invent API keys, credentials, provider capabilities, or successful test results.
- Protect customer and payment data. Do not store raw card details. Use a suitable payment provider and secure tokenization/hosted payment components where applicable.
- For Brazil-specific requirements, account for Pix, WhatsApp support where appropriate, and LGPD/privacy obligations. Confirm tax, invoicing, payment, and shipping requirements with the project owner or qualified providers rather than inventing legal rules.
- Document setup, local development, Firebase configuration, Cloudflare configuration, Prismic schemas/API access, environment variables, testing, staging, deployment, and operational maintenance.

## Implementation workflow

1. Audit the repository and map existing code to this checklist.
2. Identify missing requirements, dependencies, risks, and decisions that need owner input.
3. Propose a phased implementation plan, but preserve every checklist item.
4. Implement one coherent feature or task at a time.
5. Test the task, fix issues, and then immediately update its checkbox.
6. Re-check the full checklist after each completed task or implementation batch.
7. Continue until all applicable requirements are complete or explicitly documented as blocked/N/A.

## E-commerce requirements checklist

> Tracking rule: Every actionable requirement is represented as an unchecked checkbox. Change it to `[x]` only after implementation and verification.

This is structured as a professional e-commerce requirements checklist that you can use to plan, design, develop, or audit an online store.

### 1. Homepage

The homepage is the main entry point of your store.
- [ ] Brand identity — _in progress_: wordmark + swappable design tokens (app/app.css); awaiting owner's logo, colours and fonts
- [x] Navigation menu — header nav from Prismic categories + "Todos os produtos" (verified desktop)
- [x] Search bar — header combobox with live suggestions (verified against real catalogue)
- [x] Shopping cart icon with item counter — localStorage count, "1 item"/"N itens" label (verified 2026-11-01 with Búzios/Alaká)
- [ ] Account / login icon — _icon present_; /account not built yet
- [ ] Wishlist icon — _icon + counter present_; /wishlist not built yet
- [ ] Hero banner with promotional message — _implemented_ from Prismic `homepage`; verify after the owner creates the homepage document (fallback hero verified)
- [x] Main call-to-action buttons — Prismic-driven CTAs with "Ver todos os produtos" default (verified)
- [ ] Featured products — _implemented_ (homepage curation); needs Prismic content to verify
- [ ] Best-selling products — needs order data (Firestore) — after checkout
- [x] New arrivals — newest by Prismic publication date (verified ordering against API timestamps)
- [ ] Featured categories — _implemented_; 0 categories in Prismic yet
- [ ] Promotional banners — _implemented_ with start/end scheduling and cache capped at next boundary; needs Prismic content to verify
- [x] Discounts and special offers — "Ofertas" section + /offers list products with original_price > price (verified 2026-11-01 with Búzios/Alaká: Alaká listed, Búzios not)
- [ ] Benefits section (free shipping, secure payment, etc.) — _implemented_ from Prismic; footer trust strip verified
- [ ] Customer reviews or testimonials — _testimonials implemented_ (Prismic, real customers only); reviews pending
- [ ] Newsletter subscription — pending (needs Firestore + consent + Turnstile)
- [ ] Social media links — _implemented_ (Prismic settings → footer); needs content
- [ ] Footer with important links — _rendered_; several target pages (/about, /privacy…) not built yet
- [ ] Recently viewed products — _implemented_ (localStorage + /api/products); browser flow not verified yet
- [x] Trust badges — factual trust strip: Pix, secure checkout, support channel (verified)

### 2. Navigation and Categories

Customers must be able to find products easily.
- [x] Main navigation menu — verified desktop
- [ ] Dropdown menus — _implemented_ (disclosure buttons); needs subcategories in Prismic to verify
- [ ] Mega menu (for larger stores) — _implemented_ (subcategory panel + image); needs content
- [ ] Product categories — _implemented_ (/categories/:uid, 301 to canonical prefix); 0 categories in Prismic
- [ ] Subcategories — _implemented_ (parent_category field; membership unit-tested); needs content
- [ ] Category landing pages — _implemented_; needs content
- [x] Breadcrumb navigation — UI + BreadcrumbList JSON-LD (verified)
- [ ] Category images — _implemented_; needs content
- [ ] Category descriptions — _implemented_ (intro rich text); needs content
- [ ] Mobile navigation menu — _implemented_ (native <dialog>); not visually verified on a phone width yet
- [ ] Filters by category — query param supported; facet UI not built yet
- [x] Sorting options — featured, best-selling, newest, price, name (unit-tested + rendered)
- [x] Pagination or infinite scrolling — 24 per page, canonical keeps ?pagina (verified 24/4 split)

### 3. Product Pages

One of the most important parts of an e-commerce website.
- [x] Product name
- [ ] Product images — _implemented_ (imgix srcset); no images in Prismic yet — placeholder verified
- [ ] Product image gallery — _implemented_; needs images
- [ ] Image zoom — _implemented_ (hover + full-screen dialog); needs images
- [ ] Product videos (optional) — _implemented_ (youtube-nocookie/vimeo dnt, URL parsing unit-tested); needs content
- [ ] Product description — _implemented_; current products have no long description
- [x] Short product description — verified with Prismic content
- [x] Price — centavos, unit-tested (verified 2026-11-01 with Búzios/Alaká)
- [x] Original price (when discounted) — struck through next to the price (verified 2026-11-01 with Búzios/Alaká)
- [x] Discount percentage — computed from the two prices, mismatches flagged (verified 2026-11-01 with Búzios/Alaká: −7%)
- [x] Product SKU — variant SKU when selected (verified)
- [x] Product availability — badge + purchase state from Prismic availability (verified)
- [ ] Stock quantity (optional to display) — needs Firestore inventory
- [ ] Product variants (size, color, material, etc.) — _implemented_ (pickers, URL sync, inheritance unit-tested); no variants in data yet
- [ ] Variant-specific images — _implemented_; needs content
- [ ] Size guide (if applicable) — _implemented_ (dialog); needs content
- [x] Quantity selector — adds the chosen quantity (verified 2026-11-01 with Búzios/Alaká)
- [x] Add to cart button — adds to the cart with confirmation; disabled without price/SKU; refuses a 51st line (verified 2026-11-01 with Búzios/Alaká)
- [ ] Buy now button — _implemented_; checkout not built yet
- [ ] Add to wishlist — _implemented_ (localStorage); /wishlist page pending
- [ ] Shipping cost calculator — pending (Melhor Envio + store rates)
- [ ] Estimated delivery date — pending (with shipping quotes)
- [ ] Product specifications — _implemented_ (specs + SKU/weight/dimensions); needs content
- [ ] Product dimensions — _model + UI ready_; needs content
- [ ] Product weight — _model + UI ready_; needs content
- [ ] Materials and ingredients (where applicable) — _implemented_; needs content
- [ ] Product reviews and ratings — pending
- [ ] Customer questions and answers — pending
- [ ] Related products — _implemented_ (editor picks, then same category); needs categories/picks
- [ ] Frequently bought together — _implemented_; needs content
- [ ] Recently viewed products — _tracking implemented_; list shown on home
- [x] Share product button — Web Share API / copy link + WhatsApp share (verified rendered)
- [ ] Return policy information — _implemented_ (product notes or store summary); needs content
- [ ] Warranty information — _implemented_; needs content

### 4. Search System

- [x] Search bar
- [x] Search autocomplete — /api/search/suggest (verified with real catalogue)
- [ ] Search suggestions — _implemented_ (recent searches + Prismic suggested searches); not browser-verified
- [x] Search by product name — accent-insensitive (unit + live)
- [x] Search by SKU — incl. variant SKUs and prefixes (unit + live)
- [x] Search by category — category titles indexed (unit-tested)
- [x] Typo tolerance — fuzzy matching (unit-tested)
- [x] Synonym recognition — owner-defined synonym groups in Prismic settings + per-product keywords (unit-tested)
- [x] Search results page — /search (verified; noindex)
- [x] Filters — price, availability, size, colour, material (facets unit-tested)
- [x] Sorting — relevance + listing sorts
- [x] No-results recommendations — spelling tips, suggested searches, new arrivals (verified)
- [ ] Search history (optional) — _implemented_ (localStorage, last 5); not browser-verified
- [ ] Popular searches — _implemented_ (curated in Prismic); usage-based ranking pending

### 5. Shopping Cart

- [x] Add products to cart — from the product page (verified 2026-11-01 with Búzios/Alaká)
- [x] Remove products — per line + "remove unavailable items" (verified in browser)
- [x] Update quantities — stepper, clamped to stock, totals re-quoted by the server (verified 2026-11-01 with Búzios/Alaká)
- [ ] Change product variants — _implemented_ (per-line select, merges duplicate lines); needs variants in Prismic
- [ ] Display product images — _implemented_ (variant → product image → placeholder); placeholder verified, no images in Prismic yet
- [x] Display product names — verified, incl. deleted products shown as "Produto indisponível"
- [x] Display individual prices — unit price + compare-at + % (verified 2026-11-01 with Búzios/Alaká)
- [x] Display subtotal — server-computed, unit-tested (verified 2026-11-01 with Búzios/Alaká)
- [ ] Calculate discounts — compare-at savings computed (unit-tested); coupons/automatic promotions pending (§11)
- [ ] Apply coupon codes — pending (§11 discount engine)
- [ ] Calculate shipping — pending (Melhor Envio + store rates); cart says "calculado no checkout"
- [ ] Display estimated taxes — **blocked**: the owner/accountant must define which tax information to show and its source; not invented
- [x] Display total price — = subtotal until shipping/discounts join at checkout (verified 2026-11-01 with Búzios/Alaká)
- [x] Continue shopping button — "Continuar comprando" → /collections/all (verified)
- [ ] Proceed to checkout button — _rendered_; enabled only when every line is purchasable (disabled state verified); /checkout not built yet
- [x] Save cart between sessions — localStorage; survives reloads (verified in browser)
- [ ] Cart persistence across devices (optional) — needs sign-in (carts/{uid})
- [x] Stock validation — server quote: Firestore inventory + Prismic seed (unit + emulator tests); in the browser: 5 → 3 auto-adjust with notice, sold out blocks checkout (verified 2026-11-01 with Búzios/Alaká)
- [ ] Recommended products — _implemented_ (bought-together → related, unit-tested); needs links in Prismic

### 6. Checkout System

- [x] Guest checkout — no account needed; order 1001/1002 placed as guest (verified 2026-11-01 (browser + live action on the dev server))
- [ ] Customer login during checkout — pending (customer accounts / auth)
- [x] Contact information — name, e-mail, mobile (verified 2026-11-01 (browser + live action on the dev server))
- [x] Email address — validated, stored lowercase (verified 2026-11-01 (browser + live action on the dev server))
- [x] Phone number — validated Brazilian number, stored as +55… (verified 2026-11-01 (browser + live action on the dev server))
- [ ] Billing address — **needs input**: owner/accountant to confirm whether invoices need a billing address (delivery orders store the delivery address)
- [x] Shipping address — required for delivery, not for pickup (verified 2026-11-01 (browser + live action on the dev server))
- [ ] Different billing and shipping addresses — **needs input**: same question as billing address
- [x] Address autocomplete — CEP lookup via ViaCEP (verified 2026-11-01 (browser + live action on the dev server): 21360-201 → Av. Ministro Edgard Romero, Madureira)
- [x] Shipping method selection — flat rate or pickup; pickup-only products hide delivery (verified 2026-11-01 (browser + live action on the dev server) + integration tests)
- [x] Shipping price calculation — flat rate R$ 25,00 for all of Brazil (owner, for now) + free pickup, from settings/shipping (verified)
- [ ] Delivery estimate — pickup: handling days shown; flat rate: needs the owner's transit days (shows "prazo informado no envio")
- [ ] Coupon application — pending (§11)
- [x] Order summary — lines, subtotal, delivery, total (verified 2026-11-01 (browser + live action on the dev server))
- [ ] Tax calculation — **blocked**: owner/accountant must define tax handling; not invented
- [x] Payment method selection — Pix only (owner decision 2026-10-31), shown as the payment step
- [ ] Terms and conditions acceptance — _checkbox required and enforced server-side_; /terms page content pending in Prismic (link 404s until published)
- [ ] Privacy policy acceptance where required — _same checkbox_; /privacy content pending in Prismic (legal review)
- [x] Place order button — disabled while submitting; double submit returns the same order (verified 2026-11-01 (browser + live action on the dev server))
- [ ] Payment processing — Pix code generated per order; manual confirmation in the admin pending
- [ ] Payment confirmation — pending (admin confirms Pix)
- [x] Error handling — per-field Portuguese errors + focus (browser), changed cart → 409 with review link, store not configured → 503 notice (verified 2026-11-01 (browser + live action on the dev server) + integration tests)
- [x] Order confirmation page — QR + copia e cola + copy button + summary; guest secret link, wrong secret → 404 (verified 2026-11-01 (browser + live action on the dev server))

### 7. Payment System

- [ ] Credit card payments — **N/A**: owner decision 2026-10-31 — Pix only at launch
- [ ] Debit card payments — **N/A**: owner decision 2026-10-31 — Pix only at launch
- [ ] Digital wallets — **N/A**: owner decision 2026-10-31 — Pix only at launch
- [ ] PayPal (where available) — **N/A**: owner decision 2026-10-31 — Pix only at launch
- [ ] Apple Pay (where available) — **N/A**: owner decision 2026-10-31 — Pix only at launch
- [ ] Google Pay (where available) — **N/A**: owner decision 2026-10-31 — Pix only at launch
- [x] Pix (for Brazil) — static BR Code + QR + copia e cola per order, validated and read back (verified 2026-11-01); owner's PagSeguro random key confirmed and accepted (kept out of the repo)
- [ ] Bank transfers (where applicable) — **N/A**: Pix covers instant bank transfers; owner decision 2026-10-31: Pix only
- [ ] Installment payments — **N/A**: owner decision 2026-10-31 — Pix only (no installments) at launch
- [x] Payment status tracking — pending → confirmed by an admin; shown in /admin and on the customer order page (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Payment confirmation — manual Pix confirmation in /admin/orders/:number (owner/admin/staff): one transaction marks the order paid, turns the stock reservation into a sale, writes history + audit log; repeated or conflicting confirmations refused, incl. a confirm-vs-cancel race (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Failed payment handling — unpaid Pix orders are cancelled automatically once their deadline (settings/payment.expiryHours) passes: scheduled function expirePixOrders every 15 min, same transaction as an admin cancellation (stock released, history + audit as "system"); admins can still cancel by hand (verified 2026-11-02: 6 emulator integration tests incl. a race with an admin confirmation; the built function carries the schedule). The Cloud Scheduler trigger itself first runs after the first deploy
- [x] Refund processing — the owner returns the money in the bank app and records it in /admin/orders/:number (owner/admin): one transaction writes the refund, the new status, the units chosen to go back on sale, history + audit; a double submit records it once (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Partial refunds — any amount up to what remains; the order becomes "Reembolsado parcialmente" and shipping goes on (owner decision 2026-11-02); partial refunds add up to a full one, which ends the order (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [ ] Fraud detection
- [ ] Secure payment gateway integration
- [ ] Payment receipts
- [ ] Webhook handling
- [ ] Duplicate payment prevention — orders are idempotent (double submit → one order, verified); a static Pix code can still be paid twice — admin must spot/refund (automatic prevention needs a PSP)

### 8. Customer Account
- [ ] Customer registration
- [ ] Login
- [ ] Logout
- [ ] Password recovery
- [ ] Email verification
- [ ] Phone verification (optional)
- [ ] Profile management
- [ ] Change password
- [ ] Address book
- [ ] Multiple saved addresses
- [ ] Order history
- [ ] Order details
- [ ] Order tracking
- [ ] Wishlist
- [ ] Saved payment methods (secure tokenization)
- [ ] Return requests
- [ ] Refund history
- [ ] Downloadable invoices
- [ ] Notification preferences
- [ ] Account deletion
- [ ] Privacy settings

### 9. Order Management

- [x] Unique order number — transactional counter from 1001; concurrency-tested (integration)
- [x] Order creation — one transaction: re-price, stock reservation, number, Pix (verified 2026-11-01 (browser + live action on the dev server) + 11 integration tests)
- [x] Order confirmation — confirmation page; e-mail pending (§15)
- [x] Order status — pending_payment → paid → processing → shipped → delivered (pickup: ready → picked up); cancelled (admin or expiry job); refunded / partially_refunded (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Pending orders — "Aguardando pagamento" work queue with overdue Pix flagged; the expiry job cancels unpaid orders after expiryHours (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Paid orders — confirming the Pix moves the order to paid and sells the reserved stock; "Pagos" tab (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Processing orders — "Em preparação" step and tab; may be skipped (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Shipped orders — "Enviados" tab; flat-rate orders take carrier + tracking code + https link, pickup orders become "Pronto para retirada" (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Delivered orders — "Entregues" tab; marking needs a confirmation box (pickup: "Retirado") (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Cancelled orders — owner/admin cancel unpaid orders with a reason; stock released; the customer page says "Pedido cancelado" with a contact link; "Cancelados" tab (verified 2026-11-02: Chrome on the dev server + emulator integration tests). Cancelling a paid order belongs to refunds (§7)
- [x] Refunded orders — "Reembolsados" and "Reembolso parcial" tabs; a partially refunded row also shows its shipping stage (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [ ] Order history
- [x] Order tracking number — carrier + code + https link, editable after shipping, shown on the customer's order page (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [ ] Shipping carrier integration
- [ ] Order notifications
- [ ] Invoice generation
- [ ] Return management
- [ ] Exchange management
- [x] Refund management — refund history per order (amount, reason, note, units back on sale, who, when); customers see amounts and dates only (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [ ] Partial fulfillment
- [x] Order notes — internal notes on each order: team only, never on the customer page, can't be edited or deleted, max 200 per order (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [ ] Order export

### 10. Shipping and Delivery

- [ ] Shipping zones — **N/A**: owner decision 2026-11-01: one flat price for all of Brazil
- [x] Shipping methods — flat rate (all Brazil) + local pickup, from settings/shipping
- [x] Flat-rate shipping — R$ 25,00 for all of Brazil (owner decision 2026-11-01, for now)
- [ ] Free shipping rules — **N/A**: owner decision 2026-11-01: no free shipping at launch
- [ ] Weight-based shipping — **N/A**: owner decision 2026-11-01: one flat price for all of Brazil
- [ ] Price-based shipping — **N/A**: owner decision 2026-11-01: one flat price for all of Brazil
- [ ] Location-based shipping — **N/A**: owner decision 2026-11-01: one flat price for all of Brazil
- [ ] Real-time shipping rates — Melhor Envio later (owner decision 2026-11-01); needs account, origin CEP, product weights/dimensions
- [ ] Shipping carrier integration — Melhor Envio later (owner decision 2026-11-01)
- [ ] Delivery estimates — needs the owner's flat-rate transit days
- [ ] Tracking integration — _manual tracking built_: carrier + code + link typed by the team and shown to the customer (2026-11-02); carrier API tracking waits for Melhor Envio
- [ ] Shipping labels
- [ ] Delivery notifications
- [x] Local pickup (optional) — Mercadão de Madureira – Anexo, Galeria K, Lojas 219-220 (verified order 1002)
- [ ] International shipping (if applicable)
- [ ] Shipping restrictions — _pickup-only products enforced (integration-tested)_; other restrictions not defined
- [ ] Lost package handling

### 11. Discounts and Promotions

- [ ] Coupon codes
- [ ] Percentage discounts
- [ ] Fixed-value discounts
- [ ] Automatic discounts
- [ ] Buy one, get one promotions
- [ ] Free shipping promotions
- [ ] Flash sales
- [ ] Limited-time offers
- [ ] Product bundles
- [ ] Category discounts
- [ ] First-order discounts
- [ ] Minimum purchase requirements
- [ ] Customer-specific discounts
- [ ] Loyalty rewards
- [ ] Referral discounts
- [ ] Gift cards
- [ ] Discount usage limits
- [ ] Promotion scheduling

### 12. Reviews and Social Proof

- [ ] Product ratings
- [ ] Written reviews
- [ ] Verified purchase badges
- [ ] Customer photos
- [ ] Customer videos
- [ ] Review moderation
- [ ] Review reporting
- [ ] Review sorting
- [ ] Helpful review voting
- [ ] Average rating calculation
- [ ] Testimonials
- [ ] Trust indicators

### 13. Customer Support

- [x] Contact page — channels, hours, company details from Prismic (verified)
- [ ] Contact form
- [ ] Support email
- [ ] Phone support (if offered)
- [ ] WhatsApp integration (particularly useful in Brazil) — _implemented_ (floating button, contact page, product sharing); needs the number in Prismic settings to verify
- [ ] Live chat
- [ ] Frequently asked questions — _implemented_ (/faq + FAQPage JSON-LD); needs the Prismic FAQ document
- [ ] Help center — _FAQ by topic implemented_; needs content
- [ ] Order support
- [ ] Return and refund support
- [ ] Shipping support
- [ ] Complaint management
- [ ] Support ticket system
- [ ] Automated responses
- [ ] Business hours — _implemented_ (open-now in São Paulo time); needs hours in Prismic settings

### 14. Admin Dashboard / Back Office

The administrative system is what allows the business owner to manage the entire store.
- [ ] Dashboard
- [ ] Total revenue
- [ ] Total orders
- [ ] Total customers
- [ ] Average order value
- [ ] Conversion rate
- [ ] Sales charts
- [ ] Recent orders
- [ ] Best-selling products
- [ ] Low-stock alerts
- [ ] Product management
- [ ] Create products
- [ ] Edit products
- [ ] Delete products
- [ ] Duplicate products
- [ ] Manage categories
- [ ] Manage variants
- [ ] Upload product images
- [ ] Bulk product import/export
- [ ] Manage product attributes
- [ ] Manage product pricing
- [ ] Inventory management
- [ ] Stock tracking
- [ ] Stock adjustments
- [ ] Low-stock notifications
- [ ] Out-of-stock management
- [ ] Inventory history
- [ ] Multiple warehouse support
- [ ] SKU management
- [ ] Order management — _partial_: list, detail, confirm Pix, cancel unpaid, fulfilment steps + tracking, internal notes, refunds (verified 2026-11-02); editing orders, invoices and labels pending
- [x] View orders — /admin/orders: tabs by status with counts, newest first, 25 per page, overdue Pix flagged; /admin/orders/:number: items, totals, customer (incl. CPF), delivery, history (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [ ] Edit orders
- [x] Update order status — Pix confirm/cancel, preparing → shipped/ready → delivered/picked up (forward only), refunds; staff can do everything but cancel and refund (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Cancel orders — unpaid orders: cancel with a reason, stock released; paid orders: a full refund ("Reembolsado"), units back on sale by default before they leave the store (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Process refunds — owner/admin record full or partial refunds with reason and stock returns (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [ ] Print invoices
- [ ] Print shipping labels
- [x] Add internal notes — owner/admin/staff (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [ ] Customer management
- [ ] View customers
- [ ] Edit customer information
- [ ] View customer orders
- [ ] Customer segmentation
- [ ] Customer lifetime value
- [ ] Customer support history
- [ ] Administration
- [x] User roles — owner / admin / staff as Firebase custom claims, granted with scripts/admin/grant-role.mjs (revokes the account's sessions so changes apply at once), enforced on the server (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Admin permissions — capability table (docs/architecture.md §3) checked in every admin loader/action; staff can confirm Pix but not cancel: the page hides it and a crafted POST gets 403 (verified 2026-11-02: Chrome on the dev server + emulator integration tests)
- [x] Multiple administrators — any number of accounts can hold a role (verified with an owner and a staff account, 2026-11-02), granted with scripts/admin/grant-role.mjs; the store runs with a single owner account, so there is no /admin/users page (owner decision 2026-11-03)
- [ ] Activity logs — _partial_: auditLogs records sign-in/out, Pix confirmations, cancellations (admin and automatic), fulfilment steps, tracking edits, notes, refunds, role changes and 2FA resets (each order change in the same transaction as its entry); no viewer in the admin yet
- [ ] Store settings
- [ ] Payment settings
- [ ] Shipping settings
- [ ] Tax settings
- [ ] Email settings

### 15. Marketing and Conversion Optimization

- [ ] Newsletter signup
- [ ] Email marketing integration
- [ ] Abandoned cart emails
- [ ] Welcome emails
- [ ] Order confirmation emails
- [ ] Promotional emails
- [ ] Product recommendation engine
- [ ] Upselling
- [ ] Cross-selling
- [ ] Exit-intent offers
- [ ] Referral program
- [ ] Loyalty program
- [ ] Affiliate program
- [ ] Social sharing
- [ ] Social media integration
- [ ] Facebook Pixel / Meta Pixel
- [ ] Google Analytics 4
- [ ] Google Tag Manager
- [ ] Conversion tracking
- [ ] A/B testing

### 16. SEO (Search Engine Optimization)

- [x] SEO-friendly URLs
- [x] Custom page titles — Prismic SEO title or page title + store name
- [x] Meta descriptions — Prismic SEO description or content excerpt (≤160 chars)
- [x] Heading hierarchy — one h1 per page, h2 sections
- [ ] Image alt text — _implemented_ (Prismic alt or product name; placeholders aria-hidden); needs real images to verify
- [x] XML sitemap — products, categories, pages, lastmod from Prismic (verified 34 URLs)
- [ ] Robots.txt — _fixed in code 2026-11-03 (evening), deploy pending_: the app can't serve it in production (the Cloud Functions Framework answers /robots.txt and /favicon.ico itself with an empty 404; verified from its source), so the hosting predeploy hook scripts/robots-txt.mjs writes build/client/robots.txt from SITE_URL and Hosting serves it before the rewrite. Verified in the Hosting emulator; done once production serves it. Rules: private areas blocked; everything blocked on non-production sites
- [x] Canonical URLs — filters/sort dropped, pagination kept (verified)
- [x] Structured data / Schema.org — WebSite+SearchAction, Organization, CollectionPage (verified)
- [x] Product structured data — Offer/AggregateOffer only when a price exists (verified)
- [ ] Review structured data — pending (with reviews)
- [x] Breadcrumb structured data
- [x] Open Graph metadata — verified on product page
- [x] Social sharing previews — server-rendered OG/Twitter tags (WhatsApp/Facebook read them without JS)
- [ ] Redirect management
- [x] Custom 404 page — noindex, links to home/search (verified)
- [ ] Fast-loading pages
- [x] Indexable category pages — SSR + canonical + public cache
- [ ] Search engine verification — _implemented_ (Prismic settings → meta tags); needs codes from owner

### 17. Security

- [ ] HTTPS / SSL certificate
- [ ] Secure password hashing
- [ ] Secure authentication — _admin done_ (verified 2026-11-02): Firebase Auth sign-in → server session cookie (HttpOnly, Secure, SameSite=Lax, 12 h) minted only from a sign-in < 5 min old; revocation checked on every request; verified e-mail required; production refuses emulator (unsigned-token) mode. Customer accounts pending
- [ ] Two-factor authentication for administrators — _TOTP built 2026-11-02_: /admin/login asks accounts with an authenticator for the code, and admins without one enrol (QR shown only in the browser) before they can enter; scripts/admin/reset-mfa.mjs for a lost phone. Verified against the emulator except the TOTP exchange itself (the Auth emulator has no TOTP). Deployed 2026-11-03 and TOTP turned on in the project that day (it was off): the owner's first sign-in verifies the exchange
- [x] Role-based access control — owner/admin/staff claims + per-action capability checks on the server (unit, integration and Chrome tests, 2026-11-02)
- [ ] Protection against SQL injection
- [ ] Protection against XSS
- [x] CSRF protection — same-origin check on every non-GET request (verified live: cross-site / foreign Origin → 403); SameSite=Lax session cookie with auth
- [ ] Rate limiting
- [ ] Bot protection
- [ ] Spam protection
- [ ] Secure payment processing
- [ ] PCI DSS considerations
- [ ] Secure API endpoints
- [ ] Database backups
- [ ] Security monitoring
- [x] Audit logs — auditLogs: admin sign-in/out, Pix confirmations, cancellations (admin and the expiry job as a system actor), fulfilment, tracking, notes, refunds, role changes, 2FA resets; order changes and their entries are written in one transaction (integration-tested 2026-11-02)
- [ ] Session management — _admin done_: 12-hour admin sessions; Sair revokes every session of the account; role changes revoke; dead cookies cleared (verified 2026-11-02). Customer sessions pending
- [ ] Account lockout policies — Firebase Auth throttles repeated failed sign-ins (auth/too-many-requests; message mapped on /admin/login, not triggered in tests)
- [ ] Secrets management
- [ ] Disaster recovery plan

### 18. Legal and Compliance

Especially important if you're selling in Brazil.
- [ ] Privacy policy
- [ ] Terms and conditions
- [ ] Cookie policy
- [ ] Cookie consent management
- [ ] Return and refund policy
- [ ] Shipping policy
- [ ] Warranty policy
- [ ] Company information — _implemented_ (footer + contact: legal name, CNPJ/CPF, address); needs owner data in Prismic settings
- [ ] Contact information — _implemented_; needs owner data in Prismic settings
- [ ] Consumer protection disclosures
- [ ] LGPD compliance (Brazil)
- [ ] GDPR compliance (if applicable)
- [ ] Data access and deletion requests
- [ ] Consent management
- [ ] Tax and invoice requirements
- [ ] Clear pricing and shipping disclosures
- [ ] Clear delivery deadlines

### 19. Performance and Technical Requirements

- [ ] Responsive design
- [ ] Mobile-first design
- [ ] Tablet compatibility
- [ ] Desktop compatibility
- [ ] Fast page loading
- [ ] Image optimization
- [ ] Lazy loading
- [ ] CDN integration
- [ ] Caching
- [ ] Database optimization
- [ ] Core Web Vitals optimization
- [ ] Error logging
- [ ] Performance monitoring
- [ ] Automated backups
- [ ] Staging environment
- [ ] Automated testing — _in progress_: 132 unit tests (`npm test`) + 65 emulator integration tests (`npm run test:integration`); e2e pending
- [ ] API documentation
- [ ] Scalability
- [ ] Uptime monitoring

### 20. Accessibility

- [ ] Keyboard navigation
- [ ] Screen reader compatibility
- [x] Appropriate color contrast — all token pairs ≥ 4.5:1 text / ≥ 3:1 controls (calculations in docs/brand.md)
- [ ] Accessible forms
- [ ] Form error descriptions
- [ ] Image alt text
- [ ] Visible focus indicators
- [ ] Accessible buttons
- [x] Semantic HTML — landmarks, nav labels, lists, fieldsets
- [x] Proper heading hierarchy
- [ ] Accessible dialogs and menus
- [ ] Text resizing support

### 21. Advanced E-commerce Features

These aren't necessary for every store, but can make it significantly more powerful.
- [ ] AI product recommendations
- [ ] AI-powered search
- [ ] AI customer support chatbot
- [ ] Personalized homepage
- [ ] Personalized promotions
- [ ] Product comparison
- [ ] Advanced product configurator
- [ ] Subscription products
- [ ] Recurring payments
- [ ] Pre-orders
- [ ] Back-in-stock notifications
- [ ] Waitlists
- [ ] Digital product delivery
- [ ] Multi-language support
- [ ] Multi-currency support
- [ ] Multi-store support
- [ ] B2B purchasing
- [ ] Wholesale pricing
- [ ] Customer-specific pricing
- [ ] Marketplace functionality
- [ ] Multiple vendors
- [ ] Loyalty points
- [ ] Gift registry
- [ ] Augmented reality product previews

### 22. Essential Integrations

#### Integration
#### Purpose
- [ ] Payment gateway
| Process payments |
- [ ] Shipping API
| Calculate shipping and track deliveries |
- [ ] ERP
| Manage business operations |
- [ ] CRM
| Manage customer relationships |
- [ ] Email service
| Send transactional emails |
- [ ] WhatsApp
| Customer communication |
- [ ] Analytics
| Measure performance |
- [ ] Meta Pixel
| Advertising tracking |
- [ ] Google Analytics
| Website analytics |
- [ ] Google Merchant Center
| Product listings |
- [ ] Accounting software
| Financial management |
- [ ] Tax software
| Tax calculations and invoices |
- [ ] Fraud detection
| Prevent fraudulent transactions |
- [ ] Search engine
| Improve product discovery |

### 23. Recommended Website Structure

This is how I would organize the actual website's pages and routes.
#### E-commerce sitemap
- [x] `Homepage /`
- [x] Shop
- [x] `/collections` — index + /collections/all + /collections/:uid
- [x] `/categories` — index + /categories/:uid
- [x] `/products/:slug` — /products/:uid (Prismic UID)
- [x] `/search`
#### Shopping
- [x] `/cart` — verified (empty state, unavailable lines, removal, no-store, noindex); priced flow pending content
- [x] `/checkout` — verified (verified 2026-11-01 (browser + live action on the dev server))
- [x] `/order-confirmation` — `/order-confirmation/:number?t=…` (verified)
#### Customer
- [ ] `/account`
- [ ] `/login`
- [ ] `/register`
- [ ] `/orders`
- [ ] `/wishlist`
#### Information
- [ ] `/about` — _route implemented_ (Prismic page uid "about"); returns 404 until the owner publishes it
- [x] `/contact`
- [ ] `/faq` — _route implemented_; needs the Prismic FAQ document
- [ ] `/shipping` — _route implemented_ (Prismic page uid "shipping"); returns 404 until the owner publishes it
- [ ] `/returns` — _route implemented_ (Prismic page uid "returns"); returns 404 until the owner publishes it
#### Legal
- [ ] `/privacy` — _route implemented_ (Prismic page uid "privacy"); returns 404 until the owner publishes it
- [ ] `/terms` — _route implemented_ (Prismic page uid "terms"); returns 404 until the owner publishes it
- [ ] `/cookies` — _route implemented_ (Prismic page uid "cookies"); returns 404 until the owner publishes it
#### Marketing
- [x] `/offers`
- [ ] `/gift-cards`
- [ ] `/newsletter`
#### Admin dashboard
- [ ] `/admin/dashboard`
- [ ] `/admin/products`
- [ ] `/admin/categories`
- [x] `/admin/orders` — list + /admin/orders/:number with confirm/cancel (verified 2026-11-02)
- [ ] `/admin/customers`
- [ ] `/admin/inventory`
- [ ] `/admin/discounts`
- [ ] `/admin/analytics`
- [ ] `/admin/settings`
- [ ] `/admin/users` — **N/A**: the store has a single admin account, the owner (owner decision 2026-11-03); roles change only through scripts/admin/grant-role.mjs, which also signs the account out everywhere

### 24. Final master checklist
#### Storefront
- [ ] Homepage
- [x] Product catalog — Prismic is the source; cached per release (verified with the live repository)
- [ ] Product detail pages
- [ ] Categories and navigation
- [x] Product search and filtering
- [ ] Shopping cart
- [ ] Checkout
- [ ] Payment gateway
- [ ] Shipping calculation
- [ ] Customer authentication
- [ ] Customer account
- [ ] Order management
- [ ] Inventory management
#### Admin dashboard
- [ ] Transactional emails
- [ ] Customer support
- [ ] Refund and return system — _refunds done_ (full/partial, stock per item, 2026-11-02); return requests by customers and exchanges not built
- [ ] Security
- [ ] Legal pages and compliance
- [ ] Mobile responsiveness
- [ ] SEO
- [ ] Analytics
- [ ] Backups and monitoring

## Definition of done

The platform is ready for release only when all applicable checklist items have been implemented, tested, and marked complete; Firebase Authentication and Firebase Hosting are configured; Cloudflare integration is documented and verified; Prismic is the production source for product content/catalog data; security, privacy, accessibility, performance, and operational checks have been completed; and deployment and maintenance documentation is available.

## Progress report format

At the end of each work session or meaningful batch, provide:

- **Completed:** checklist items implemented and verified in this batch.
- **Still pending:** next unchecked items.
- **Blocked / needs input:** requirements that cannot proceed, with the exact reason.
- **Verification:** tests, commands, manual checks, and outcomes.
- **Checklist updated:** confirm that each completed item was checked immediately after completion.

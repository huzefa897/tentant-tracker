# Tenants (tenancies)

## Backend

**Tenants are tenancies** (`properties.Tenancy`): one occupant of one flat over a period, with its own UUID, so a flat has many tenancies over time and bills belong to the tenancy. Tenants never sign in.

- Status (upcoming/current/ended) is derived from the dates on the India business date (`business_date()`), never stored; end dates are inclusive.
- Validation lives on the model (admin uses it) with database check constraints behind it. Overlapping tenancies of one flat are refused by `clean()` (naming the clash) and, against simultaneous saves, by a PostgreSQL exclusion constraint (`btree_gist`; model validation skips it via `get_constraints` so the message isn't repeated).
- **Due day** (`rent_due_day`, 1–31): left empty in admin, it's the start date's day (a tenant who started on the 15th pays on the 15th). It can change at any time, e.g. to the 1st; each month's rental period saves the due date worked out when it was created, and the months already due are created before a change is saved, so a change only affects months not yet due ([rent-entries.md](rent-entries.md#rental-periods-and-due-dates)).
- **Meter baseline** (admin's **Enable meter reading tracking** and **Initial meter reading**; `meter_baseline_recorded_at` is set by the server): where the tenancy's electricity meter is measured from, empty while tracking is off, fixed (and tracking kept on) once it has readings ([meter-readings.md](meter-readings.md)). The API returns it as `meterBaseline`.
- A tenancy with bills can't change property (bills are scoped through it): `Tenancy.clean()` and `save()` (under the same row lock as bill creation) refuse it, and admin shows the property read-only.
- The tenancy API is read-only and nested under the property (`/api/v1/properties/{id}/tenancies/`), found through `properties_for_user` first.

## App

Tenants come from the backend's tenancies of the selected property (`services/tenant.service.ts`, which validates each response as a `TenancyDto` and maps it to the app's `Tenant`, converting the decimal-string money to numbers; `Tenant.id` is the tenancy UUID).

`stores/tenant.ts` keeps the search **results** (current tenancies only, paginated with Load more, for the query they answer) apart from a **cache of tenants by id**, which also holds tenants loaded by id; `selectedTenant` comes from the cache, so a search that leaves the selected tenant out never loses it. The selector searches through the API 300 ms after typing pauses (`TenantSelector` emits `search`); every list request is numbered and only the newest may change state, so an older response never replaces a newer search. Changing the selected property (switching, logout, lost access) resets the tenant store at once (a sync watcher in the store) and discards pending responses. A failed load is an error with Retry, never "No current tenants found."

Pages opened by URL load their tenant through the detail API (`loadTenant`, any status), so they never depend on visiting the dashboard. Tenant pages (the tenant page, new entry, history, details, meter) get their tenant from `composables/useRouteTenant.ts`, which reports a failed tenant load as an error with Retry, never as "Tenant not found".

## Tenants list

**Tenants** in the nav (`/tenants`, `TenantsView`) lists the selected property's current tenants (`TenantList`: name, flat, rent and due day, a meter icon when it's tracked), searched by name or flat 300 ms after typing pauses and paged with Load more, through the same store as the dashboard's search. Each opens the tenant page. Loading shows skeleton rows under the search box; a failed load is an error with Retry (and auto-retries), never "No current tenants."

## Tenant page

`/tenants/:tenantId` (`TenantView`) is one tenant, opened from Tenants, the dashboard's search or a link (the tenant through `useRouteTenant`, so a refresh or a shared link works; Tenant not found offers **Go to tenants**). The card (`TenantDetails`) has the name and flat as its heading, never repeated below, then the tenancy's terms as one compact list (rent, the day it’s due each month, electricity rate, deposit, and the mobile number as a `tel:` link), then **New bill**, **Bills (n)** and, with a meter, **Meter readings**. Below the name it shows their latest bill by billing month (`LatestEntryCard`, via `TenantDetails`' `latest-entry` slot) and their bill count, from the first page of their bills (`loadSummary`, reloaded each time the page opens): a skeleton of the card while loading (and while it auto-retries a failure), nothing when they have none. Format money with `utils/currency.ts` (`formatINR`) and days with `utils/date.ts` (`formatOrdinal`).

## Dashboard

The dashboard opens on **Rent due** ([dashboard.md](dashboard.md)). The tenant search sits centred at the top of the card (`AppLayout`'s `#toolbar` slot); choosing a tenant opens their page. The store still keeps a `selectedTenantId` (cleared on a property change or logout), but no screen selects one now.


# Tenants (tenancies)

## Backend

**Tenants are tenancies** (`properties.Tenancy`): one occupant of one flat over a period, with its own UUID, so a flat has many tenancies over time and bills belong to the tenancy. Tenants never sign in.

- Status (upcoming/current/ended) is derived from the dates on the India business date (`business_date()`), never stored; end dates are inclusive.
- Validation lives on the model (admin uses it) with database check constraints behind it. Overlapping tenancies of one flat are refused by `clean()` (naming the clash) and, against simultaneous saves, by a PostgreSQL exclusion constraint (`btree_gist`; model validation skips it via `get_constraints` so the message isn't repeated).
- **Due day** (`rent_due_day`, 1–31): left empty in admin, it's the start date's day (a tenant who started on the 15th pays on the 15th). It can change at any time, e.g. to the 1st; each bill saves the due date worked out when it was created, so a change only affects new bills ([rent-entries.md](rent-entries.md#due-dates)).
- A tenancy with bills can't change property (bills are scoped through it): `Tenancy.clean()` and `save()` (under the same row lock as bill creation) refuse it, and admin shows the property read-only.
- The tenancy API is read-only and nested under the property (`/api/v1/properties/{id}/tenancies/`), found through `properties_for_user` first.

## App

Tenants come from the backend's tenancies of the selected property (`services/tenant.service.ts`, which validates each response as a `TenancyDto` and maps it to the app's `Tenant`, converting the decimal-string money to numbers; `Tenant.id` is the tenancy UUID).

`stores/tenant.ts` keeps the search **results** (current tenancies only, paginated with Load more, for the query they answer) apart from a **cache of tenants by id**, which also holds tenants loaded by id; `selectedTenant` comes from the cache, so a search that leaves the selected tenant out never loses it. The selector searches through the API 300 ms after typing pauses (`TenantSelector` emits `search`); every list request is numbered and only the newest may change state, so an older response never replaces a newer search. Changing the selected property (switching, logout, lost access) resets the tenant store at once (a sync watcher in the store) and discards pending responses. A failed load is an error with Retry, never "No current tenants found."

Pages opened by URL load their tenant through the detail API (`loadTenant`, any status), so they never depend on visiting the dashboard. Tenant pages (new entry, history, details) get their tenant from `composables/useRouteTenant.ts`, which reports a failed tenant load as an error with Retry, never as "Tenant not found".

## Dashboard

The tenant search sits centred at the top of the card (`AppLayout`'s `#toolbar` slot). The dashboard never auto-selects a tenant. Below the selected tenant's name it shows their latest bill by billing month (`LatestEntryCard`, via `TenantDetails`' `latest-entry` slot) and their bill count, from the first page of their bills (`loadSummary`, reloaded whenever a tenant is selected): a skeleton of the card while loading, nothing when they have none, and an error with Retry when it fails. Format money with `utils/currency.ts` (`formatINR`) and days with `utils/date.ts` (`formatOrdinal`).

# Testing with fakes

The rules (tests ship with every change, where they live, what to assert) are in `CLAUDE.md`. This covers the shared fakes and fixtures.

Tests never touch Firebase or the API: mock the services with the shared fakes, `vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))` and the same for `access.service`, `tenant.service` and `rentEntry.service`, calling `resetAuthService()`/`resetAccessService()`/`resetTenantService()`/`resetRentEntryService()` in `beforeEach`.

- **Sign-in and access:** `signInAs()` sets the session Firebase "restores"; the default identity has one property, so protected pages open directly.
- **Tenants:** the tenant fake searches and pages its fictional `testTenants` (ids `tenant-001`…) like the API; `fakeTenancies` changes them or the page size, and `loadTestTenants()` (`src/test/tenants.ts`) signs in, selects the property and loads them for store tests.
- **Bills:** the rent entry fake saves, filters and pages `fakeEntries.entries` like the API (409 for a duplicate month). `fakeEntries.rate` makes the "server" charge another rate, and `fakeEntries.rent` another rent when the form left it unedited. Build bills with `makeEntry` (`src/test/rentEntryFixtures.ts`, re-exported by `src/test/rentEntries.ts`): its figures follow its charges unless overridden. Fakes import fixtures from `rentEntryFixtures.ts`, never `rentEntries.ts`, which imports the router (a cycle through the mocked service).
- **Router:** it's shared across tests: navigate with `force: true` when the path may already be current.

Backend tests mock `verify_firebase_token` and never call live Firebase; the concurrency tests need PostgreSQL.

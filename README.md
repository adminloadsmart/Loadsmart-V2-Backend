# Loadsmart-V2-Backend

## Database Migrations

Schema changes are managed exclusively by TypeORM migrations in `src/db/migrations/`
(`npm run migration:run`). `synchronize` is permanently disabled in
`src/db/data-source.ts` — no schema change should ever rely on it.

**Fresh database:** `npm run migration:run` just works.

**Local database with pre-existing schema:** early in this project, the app ran with
`synchronize: true` (only fully disabled 2026-08-18), which auto-created tables/enum
types straight from the entities on every boot. If your local Postgres database was
ever used with the app before that, it already has some or all of the objects the
migrations try to create, and `migration:run` will fail with errors like `type "..."
already exists` or `column "..." already exists`. Since this is disposable local dev
data, the fix is to drop and recreate the database and run migrations on a truly empty
one:

```
dropdb loadsmart && createdb loadsmart   # or your DATABASE_URL's db name
npm run migration:run
npm run seed:roles
```

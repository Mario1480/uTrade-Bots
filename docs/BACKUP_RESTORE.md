# Backup & Restore (Postgres)

This project uses Postgres in Docker. The scripts below run `pg_dump`/`psql` inside the `postgres` container.

## Backup

```sh
scripts/backup_db.sh
```

Defaults:
- `COMPOSE_FILE=docker-compose.dev.yml`
- `BACKUP_DIR=/opt/market-maker/backups`
- `DB_NAME=marketmaker`
- `DB_USER=mm`

The script writes a timestamped file like:
```
/opt/market-maker/backups/mm_YYYYMMDD_HHMM.sql.gz
```

Retention:
- Deletes backups older than 14 days.

Override defaults:
```sh
COMPOSE_FILE=docker-compose.dev.yml \
BACKUP_DIR=/opt/market-maker/backups \
DB_NAME=marketmaker \
DB_USER=mm \
scripts/backup_db.sh
```

## Restore

```sh
scripts/restore_db.sh /opt/market-maker/backups/mm_YYYYMMDD_HHMM.sql.gz
```

What it does:
1) Stops `api` and `runner`
2) Restores the SQL into the Postgres container
3) Starts `api` and `runner` again

Override defaults:
```sh
COMPOSE_FILE=docker-compose.dev.yml \
DB_NAME=marketmaker \
DB_USER=mm \
scripts/restore_db.sh /opt/market-maker/backups/mm_YYYYMMDD_HHMM.sql.gz
```

## Automation (cron)

Example daily 03:00 backup:
```
0 3 * * * /opt/market-maker/scripts/backup_db.sh >> /opt/market-maker/backups/backup.log 2>&1
```

## Notes
- Run backups from the server where `/opt/market-maker` exists.
- Ensure the backup file is readable by the user running the script.

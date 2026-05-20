use rusqlite::Connection;

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS shortcuts (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            original_path TEXT NOT NULL,
            managed_path TEXT NOT NULL,
            target_path TEXT,
            icon_path TEXT,
            last_opened_at TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            color TEXT NOT NULL,
            x INTEGER,
            y INTEGER,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            is_open INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );
        ",
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_required_tables() {
        let conn = Connection::open_in_memory().expect("open in-memory database");

        migrate(&conn).expect("run migrations");

        let shortcuts_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'shortcuts'",
                [],
                |row| row.get(0),
            )
            .expect("query shortcuts table");
        let notes_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
                [],
                |row| row.get(0),
            )
            .expect("query notes table");

        assert_eq!(shortcuts_count, 1);
        assert_eq!(notes_count, 1);
    }
}

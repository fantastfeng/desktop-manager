use rusqlite::Connection;

use crate::models::ShortcutRecord;

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

pub fn insert_shortcut(conn: &Connection, shortcut: &ShortcutRecord) -> rusqlite::Result<()> {
    conn.execute(
        "
        INSERT INTO shortcuts (
            id,
            name,
            original_path,
            managed_path,
            target_path,
            icon_path,
            last_opened_at,
            created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
        (
            &shortcut.id,
            &shortcut.name,
            &shortcut.original_path,
            &shortcut.managed_path,
            &shortcut.target_path,
            &shortcut.icon_path,
            &shortcut.last_opened_at,
            &shortcut.created_at,
        ),
    )?;

    Ok(())
}

pub fn list_shortcuts(conn: &Connection) -> rusqlite::Result<Vec<ShortcutRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT
            id,
            name,
            original_path,
            managed_path,
            target_path,
            icon_path,
            last_opened_at,
            created_at
        FROM shortcuts
        ORDER BY name COLLATE NOCASE ASC
        ",
    )?;

    let records = statement
        .query_map([], row_to_shortcut)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(records)
}

pub fn find_shortcut(conn: &Connection, id: &str) -> rusqlite::Result<Option<ShortcutRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT
            id,
            name,
            original_path,
            managed_path,
            target_path,
            icon_path,
            last_opened_at,
            created_at
        FROM shortcuts
        WHERE id = ?1
        ",
    )?;

    match statement.query_row([id], row_to_shortcut) {
        Ok(shortcut) => Ok(Some(shortcut)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn delete_shortcut(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM shortcuts WHERE id = ?1", [id])?;
    Ok(())
}

pub fn mark_shortcut_opened(conn: &Connection, id: &str, opened_at: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE shortcuts SET last_opened_at = ?1 WHERE id = ?2",
        (opened_at, id),
    )?;
    Ok(())
}

fn row_to_shortcut(row: &rusqlite::Row<'_>) -> rusqlite::Result<ShortcutRecord> {
    Ok(ShortcutRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        original_path: row.get(2)?,
        managed_path: row.get(3)?,
        target_path: row.get(4)?,
        icon_path: row.get(5)?,
        last_opened_at: row.get(6)?,
        created_at: row.get(7)?,
    })
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

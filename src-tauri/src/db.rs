use rusqlite::Connection;

use crate::models::{NoteRecord, ShortcutRecord};

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

pub fn insert_note(conn: &Connection, note: &NoteRecord) -> rusqlite::Result<()> {
    conn.execute(
        "
        INSERT INTO notes (
            id,
            title,
            content,
            color,
            x,
            y,
            width,
            height,
            is_open,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ",
        (
            &note.id,
            &note.title,
            &note.content,
            &note.color,
            &note.x,
            &note.y,
            &note.width,
            &note.height,
            bool_to_sqlite(note.is_open),
            &note.updated_at,
        ),
    )?;

    Ok(())
}

pub fn list_notes(conn: &Connection) -> rusqlite::Result<Vec<NoteRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT
            id,
            title,
            content,
            color,
            x,
            y,
            width,
            height,
            is_open,
            updated_at
        FROM notes
        ORDER BY updated_at DESC
        ",
    )?;

    let records = statement
        .query_map([], row_to_note)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(records)
}

pub fn find_note(conn: &Connection, id: &str) -> rusqlite::Result<Option<NoteRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT
            id,
            title,
            content,
            color,
            x,
            y,
            width,
            height,
            is_open,
            updated_at
        FROM notes
        WHERE id = ?1
        ",
    )?;

    match statement.query_row([id], row_to_note) {
        Ok(note) => Ok(Some(note)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn update_note(conn: &Connection, note: &NoteRecord) -> rusqlite::Result<()> {
    conn.execute(
        "
        UPDATE notes
        SET
            title = ?1,
            content = ?2,
            color = ?3,
            x = ?4,
            y = ?5,
            width = ?6,
            height = ?7,
            is_open = ?8,
            updated_at = ?9
        WHERE id = ?10
        ",
        (
            &note.title,
            &note.content,
            &note.color,
            &note.x,
            &note.y,
            &note.width,
            &note.height,
            bool_to_sqlite(note.is_open),
            &note.updated_at,
            &note.id,
        ),
    )?;

    Ok(())
}

pub fn delete_note(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
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

fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRecord> {
    let is_open: i64 = row.get(8)?;
    Ok(NoteRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        color: row.get(3)?,
        x: row.get(4)?,
        y: row.get(5)?,
        width: row.get(6)?,
        height: row.get(7)?,
        is_open: is_open != 0,
        updated_at: row.get(9)?,
    })
}

fn bool_to_sqlite(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NoteRecord;

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

    #[test]
    fn note_crud_persists_and_reads_bool_state() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("run migrations");

        let note = NoteRecord {
            id: "note-1".to_string(),
            title: "First".to_string(),
            content: "Draft".to_string(),
            color: "#fff4b8".to_string(),
            x: Some(12),
            y: Some(34),
            width: 320,
            height: 260,
            is_open: true,
            updated_at: "2026-05-21T00:00:00Z".to_string(),
        };

        insert_note(&conn, &note).expect("insert note");

        assert_eq!(list_notes(&conn).expect("list notes"), vec![note.clone()]);
        assert_eq!(
            find_note(&conn, "note-1").expect("find note"),
            Some(note.clone())
        );

        let updated = NoteRecord {
            id: "note-1".to_string(),
            title: "Updated".to_string(),
            content: "Body".to_string(),
            color: "#abcdef".to_string(),
            x: None,
            y: Some(45),
            width: 480,
            height: 360,
            is_open: false,
            updated_at: "2026-05-21T01:00:00Z".to_string(),
        };

        update_note(&conn, &updated).expect("update note");

        assert_eq!(
            find_note(&conn, "note-1").expect("find updated note"),
            Some(updated.clone())
        );

        delete_note(&conn, "note-1").expect("delete note");

        assert!(list_notes(&conn).expect("list after delete").is_empty());
        assert_eq!(find_note(&conn, "note-1").expect("find after delete"), None);
    }
}

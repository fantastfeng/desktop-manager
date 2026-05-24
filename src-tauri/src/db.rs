use rusqlite::Connection;

use crate::models::{DesktopCategoryRecord, DesktopItemRecord, DesktopKind};

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS desktop_categories (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            color TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS desktop_items (
            id TEXT PRIMARY KEY NOT NULL,
            category_id TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            kind TEXT NOT NULL,
            modified_at TEXT,
            icon_path TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(category_id) REFERENCES desktop_categories(id)
        );

        ",
    )?;

    let has_column: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('desktop_items') WHERE name = 'sort_order'")?
        .query_row([], |_| Ok(()))
        .is_ok();
    if !has_column {
        conn.execute_batch(
            "ALTER TABLE desktop_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;",
        )?;
    }

    let has_category_color_column: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('desktop_categories') WHERE name = 'color'")?
        .query_row([], |_| Ok(()))
        .is_ok();
    if !has_category_color_column {
        conn.execute_batch("ALTER TABLE desktop_categories ADD COLUMN color TEXT;")?;
    }

    conn.execute_batch(
        "
        INSERT INTO desktop_categories (id, name, kind, sort_order, color, created_at)
        SELECT 'software', '软件', 'software', 0, NULL, '1970-01-01T00:00:00Z'
        WHERE NOT EXISTS (SELECT 1 FROM desktop_categories)
        UNION ALL
        SELECT 'files', '文件', 'file', 1, NULL, '1970-01-01T00:00:00Z'
        WHERE NOT EXISTS (SELECT 1 FROM desktop_categories)
        UNION ALL
        SELECT 'folders', '文件夹', 'folder', 2, NULL, '1970-01-01T00:00:00Z'
        WHERE NOT EXISTS (SELECT 1 FROM desktop_categories);
        ",
    )?;

    Ok(())
}

pub fn list_desktop_categories(conn: &Connection) -> rusqlite::Result<Vec<DesktopCategoryRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT id, name, kind, sort_order, color, created_at
        FROM desktop_categories
        ORDER BY sort_order ASC, name COLLATE NOCASE ASC
        ",
    )?;

    let records = statement
        .query_map([], |row| {
            Ok(DesktopCategoryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: DesktopKind::from_str(&row.get::<_, String>(2)?),
                sort_order: row.get(3)?,
                color: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(records)
}

pub fn insert_desktop_category(
    conn: &Connection,
    category: &DesktopCategoryRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "
        INSERT INTO desktop_categories (id, name, kind, sort_order, color, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ",
        (
            &category.id,
            &category.name,
            category.kind.as_str(),
            category.sort_order,
            &category.color,
            &category.created_at,
        ),
    )?;
    Ok(())
}

pub fn update_desktop_category_order(
    conn: &Connection,
    ordered_ids: &[String],
) -> rusqlite::Result<()> {
    for (index, id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE desktop_categories SET sort_order = ?1 WHERE id = ?2",
            (index as i64, id),
        )?;
    }
    Ok(())
}

pub fn update_desktop_category_color(
    conn: &Connection,
    id: &str,
    color: Option<&str>,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE desktop_categories SET color = ?1 WHERE id = ?2",
        (color, id),
    )
}

pub fn delete_desktop_category(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM desktop_items WHERE category_id = ?1", [id])?;
    conn.execute("DELETE FROM desktop_categories WHERE id = ?1", [id])
}

pub fn insert_desktop_item(conn: &Connection, item: &DesktopItemRecord) -> rusqlite::Result<()> {
    conn.execute(
        "
        INSERT INTO desktop_items (
            id, category_id, name, path, kind, modified_at, icon_path, sort_order, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ",
        (
            &item.id,
            &item.category_id,
            &item.name,
            &item.path,
            item.kind.as_str(),
            &item.modified_at,
            &item.icon_path,
            item.sort_order,
            &item.created_at,
        ),
    )?;
    Ok(())
}

pub fn compute_next_sort_order(conn: &Connection, category_id: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM desktop_items WHERE category_id = ?1",
        [category_id],
        |row| row.get(0),
    )
}

pub fn list_desktop_items(
    conn: &Connection,
    category_id: &str,
) -> rusqlite::Result<Vec<DesktopItemRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT id, category_id, name, path, kind, modified_at, icon_path, sort_order, created_at
        FROM desktop_items
        WHERE category_id = ?1
        ORDER BY sort_order ASC, name COLLATE NOCASE ASC
        ",
    )?;

    let records = statement
        .query_map([category_id], row_to_desktop_item)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(records)
}

pub fn find_desktop_item(
    conn: &Connection,
    id: &str,
) -> rusqlite::Result<Option<DesktopItemRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT id, category_id, name, path, kind, modified_at, icon_path, sort_order, created_at
        FROM desktop_items
        WHERE id = ?1
        ",
    )?;

    match statement.query_row([id], row_to_desktop_item) {
        Ok(item) => Ok(Some(item)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn delete_desktop_item(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM desktop_items WHERE id = ?1", [id])
}

pub fn update_desktop_item_name(
    conn: &Connection,
    id: &str,
    name: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE desktop_items SET name = ?1 WHERE id = ?2",
        (name, id),
    )
}

pub fn update_desktop_item_category(
    conn: &Connection,
    id: &str,
    category_id: &str,
    sort_order: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE desktop_items SET category_id = ?1, sort_order = ?2 WHERE id = ?3",
        (category_id, sort_order, id),
    )
}

pub fn reorder_desktop_items(
    conn: &Connection,
    category_id: &str,
    ordered_ids: &[String],
) -> rusqlite::Result<()> {
    for (index, id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE desktop_items SET sort_order = ?1 WHERE id = ?2 AND category_id = ?3",
            (index as i64, id, category_id),
        )?;
    }
    Ok(())
}

fn row_to_desktop_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<DesktopItemRecord> {
    let kind: String = row.get(4)?;
    Ok(DesktopItemRecord {
        id: row.get(0)?,
        category_id: row.get(1)?,
        name: row.get(2)?,
        path: row.get(3)?,
        kind: DesktopKind::from_str(&kind),
        modified_at: row.get(5)?,
        icon_path: row.get(6)?,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_required_tables() {
        let conn = Connection::open_in_memory().expect("open in-memory database");

        migrate(&conn).expect("run migrations");

        let desktop_categories_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'desktop_categories'",
                [],
                |row| row.get(0),
            )
            .expect("query desktop categories table");
        let desktop_items_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'desktop_items'",
                [],
                |row| row.get(0),
            )
            .expect("query desktop items table");

        assert_eq!(desktop_categories_count, 1);
        assert_eq!(desktop_items_count, 1);
    }

    #[test]
    fn desktop_item_crud_persists_categories_and_items() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("run migrations");

        let categories = list_desktop_categories(&conn).expect("list categories");
        assert_eq!(
            categories
                .iter()
                .map(|category| category.name.as_str())
                .collect::<Vec<_>>(),
            vec!["软件", "文件", "文件夹"]
        );

        let dev_category = DesktopCategoryRecord {
            id: "dev-tools".to_string(),
            name: "开发软件".to_string(),
            kind: DesktopKind::Software,
            sort_order: 3,
            color: None,
            created_at: "2026-05-21T10:23:00Z".to_string(),
        };
        insert_desktop_category(&conn, &dev_category).expect("insert custom software category");
        update_desktop_category_order(
            &conn,
            &[
                "files".to_string(),
                "software".to_string(),
                "folders".to_string(),
                "dev-tools".to_string(),
            ],
        )
        .expect("reorder categories");
        assert_eq!(
            list_desktop_categories(&conn)
                .expect("list reordered categories")
                .iter()
                .map(|category| category.id.as_str())
                .collect::<Vec<_>>(),
            vec!["files", "software", "folders", "dev-tools"]
        );

        let item = DesktopItemRecord {
            id: "item-1".to_string(),
            category_id: "files".to_string(),
            name: "方案.docx".to_string(),
            path: r"C:\Users\me\Desktop\方案.docx".to_string(),
            kind: DesktopKind::File,
            modified_at: Some("2026-05-21T10:24:00Z".to_string()),
            icon_path: None,
            sort_order: 0,
            created_at: "2026-05-21T10:25:00Z".to_string(),
        };

        insert_desktop_item(&conn, &item).expect("insert desktop item");

        assert_eq!(
            list_desktop_items(&conn, "files").expect("list file items"),
            vec![item.clone()]
        );
        assert_eq!(
            find_desktop_item(&conn, "item-1").expect("find desktop item"),
            Some(item)
        );

        assert_eq!(
            delete_desktop_item(&conn, "item-1").expect("delete desktop item"),
            1
        );
        assert_eq!(
            find_desktop_item(&conn, "item-1").expect("find removed desktop item"),
            None
        );
    }

    #[test]
    fn desktop_item_name_and_category_color_can_be_updated() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("run migrations");

        update_desktop_category_color(&conn, "software", Some("#2563eb"))
            .expect("update category color");
        assert_eq!(
            list_desktop_categories(&conn)
                .expect("list categories")
                .into_iter()
                .find(|category| category.id == "software")
                .expect("software category")
                .color,
            Some("#2563eb".to_string())
        );

        let item = DesktopItemRecord {
            id: "code-shortcut".to_string(),
            category_id: "software".to_string(),
            name: "Code".to_string(),
            path: r"C:\Apps\Code.lnk".to_string(),
            kind: DesktopKind::Software,
            modified_at: None,
            icon_path: None,
            sort_order: 0,
            created_at: "2026-05-21T10:25:00Z".to_string(),
        };
        insert_desktop_item(&conn, &item).expect("insert desktop item");
        update_desktop_item_name(&conn, "code-shortcut", "VS Code").expect("rename desktop item");

        assert_eq!(
            find_desktop_item(&conn, "code-shortcut")
                .expect("find renamed item")
                .expect("renamed item")
                .name,
            "VS Code"
        );
    }

    #[test]
    fn desktop_item_can_move_between_categories() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("run migrations");
        insert_desktop_category(
            &conn,
            &DesktopCategoryRecord {
                id: "dev-tools".to_string(),
                name: "开发软件".to_string(),
                kind: DesktopKind::Software,
                sort_order: 3,
                color: None,
                created_at: "2026-05-21T10:23:00Z".to_string(),
            },
        )
        .expect("insert target category");
        let item = DesktopItemRecord {
            id: "code-shortcut".to_string(),
            category_id: "software".to_string(),
            name: "Code".to_string(),
            path: r"C:\Apps\Code.lnk".to_string(),
            kind: DesktopKind::Software,
            modified_at: None,
            icon_path: None,
            sort_order: 0,
            created_at: "2026-05-21T10:25:00Z".to_string(),
        };
        insert_desktop_item(&conn, &item).expect("insert desktop item");

        assert_eq!(
            update_desktop_item_category(&conn, "code-shortcut", "dev-tools", 0)
                .expect("move desktop item"),
            1
        );

        assert_eq!(
            list_desktop_items(&conn, "software").expect("list source items"),
            Vec::<DesktopItemRecord>::new()
        );
        let moved = find_desktop_item(&conn, "code-shortcut")
            .expect("find moved item")
            .expect("moved item");
        assert_eq!(moved.category_id, "dev-tools");
        assert_eq!(moved.sort_order, 0);
    }

    #[test]
    fn delete_desktop_category_removes_category_and_its_items() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("run migrations");

        let item = DesktopItemRecord {
            id: "game-1".to_string(),
            category_id: "software".to_string(),
            name: "Game".to_string(),
            path: r"C:\Games\Game.lnk".to_string(),
            kind: DesktopKind::Software,
            modified_at: None,
            icon_path: None,
            sort_order: 0,
            created_at: "2026-05-21T10:25:00Z".to_string(),
        };
        insert_desktop_item(&conn, &item).expect("insert desktop item");

        assert_eq!(
            delete_desktop_category(&conn, "software").expect("delete desktop category"),
            1
        );
        assert!(!list_desktop_categories(&conn)
            .expect("list categories")
            .iter()
            .any(|category| category.id == "software"));
        assert_eq!(
            list_desktop_items(&conn, "software").expect("list removed category items"),
            Vec::<DesktopItemRecord>::new()
        );
    }

    #[test]
    fn migrate_does_not_recreate_deleted_default_category_when_other_categories_exist() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("run migrations");

        delete_desktop_category(&conn, "software").expect("delete software category");
        migrate(&conn).expect("run migrations again");

        assert!(!list_desktop_categories(&conn)
            .expect("list categories")
            .iter()
            .any(|category| category.id == "software"));
    }

    #[test]
    fn migrate_adds_category_color_before_default_category_insert() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(
            "
            CREATE TABLE desktop_categories (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            ",
        )
        .expect("create old categories table");

        migrate(&conn).expect("migrate old categories table");

        let color_column_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('desktop_categories') WHERE name = 'color'",
                [],
                |row| row.get(0),
            )
            .expect("query color column");
        assert_eq!(color_column_count, 1);
        assert_eq!(
            list_desktop_categories(&conn)
                .expect("list categories")
                .len(),
            3
        );
    }
}

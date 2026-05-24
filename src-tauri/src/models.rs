#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DesktopKind {
    Software,
    File,
    Folder,
}

impl DesktopKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Software => "software",
            Self::File => "file",
            Self::Folder => "folder",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "software" => Self::Software,
            "folder" => Self::Folder,
            "file" => Self::File,
            other => {
                eprintln!("Warning: unknown DesktopKind value '{other}', defaulting to File");
                Self::File
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopCategoryRecord {
    pub id: String,
    pub name: String,
    pub kind: DesktopKind,
    pub sort_order: i64,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopItemRecord {
    pub id: String,
    pub category_id: String,
    pub name: String,
    pub path: String,
    pub kind: DesktopKind,
    pub modified_at: Option<String>,
    pub icon_path: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

use std::path::{Path, PathBuf};

pub fn icon_cache_path(icons_dir: &Path, source_path: &Path) -> PathBuf {
    icons_dir.join(format!(
        "{:016x}.png",
        fnv1a_hash(source_path.to_string_lossy().to_lowercase().as_bytes())
    ))
}

fn fnv1a_hash(data: &[u8]) -> u64 {
    data.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_cache_path_is_stable() {
        let icons_dir = PathBuf::from("icons");
        let shortcut_path = PathBuf::from(r"C:\Users\me\Desktop\Notes.lnk");

        let first = icon_cache_path(&icons_dir, &shortcut_path);
        let second = icon_cache_path(&icons_dir, &shortcut_path);

        assert_eq!(first, second);
        assert_eq!(first.parent(), Some(icons_dir.as_path()));
        assert_eq!(
            first.extension().and_then(|value| value.to_str()),
            Some("png")
        );
    }
}

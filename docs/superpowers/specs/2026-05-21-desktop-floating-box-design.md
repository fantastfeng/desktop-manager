# Desktop Floating Box Design

## Goal

Build the app as a small, draggable, semi-transparent desktop utility window for organizing and opening software shortcuts, files, and folders.

## Window

- The main window is borderless and semi-transparent.
- The whole title area can be dragged to move the window.
- The default size should be compact, closer to a vertical drawer than a dashboard.
- The window keeps lightweight controls for minimize and close.

## Categories

The default categories are:

- Software: stores software launch entries such as `.lnk` shortcuts and `.exe` files.
- Files: stores documents and other files, including Word, PowerPoint, PDF, images, and similar file types.
- Folders: stores folders.

The category bar includes a plus button. The plus button opens a small category creation flow. New categories are user-defined and appear after the default three categories.

## Adding Items

The primary add interaction is drag and drop:

- Dragging a shortcut or executable into the window automatically adds it to Software.
- Dragging a file into the window automatically adds it to Files.
- Dragging a folder into the window automatically adds it to Folders.
- While dragging over the window, the drop area highlights so the user knows the item can be added.

The plus button remains available for manual add flows, but drag and drop is the default fast path.

## Display

Software uses an icon grid:

- Each software item shows its icon and name.
- Activating the item launches the target.

Files and Folders use a Windows-style details list:

- Columns: Name and Modified Time.
- Clicking Name sorts by file or folder name.
- Clicking Modified Time sorts by modified timestamp.
- Repeated clicks toggle ascending and descending order.
- Activating a file opens it with the system default app.
- Activating a folder opens the folder in Explorer.

## Persistence

The app persists categories and added items locally. Stored item records include:

- id
- category id
- display name
- original path
- item type: software, file, or folder
- modified time when available
- icon path when available
- created time

The app should not move user files or folders when adding them. It should store references to paths and open those paths on demand.

## Error Handling

- If a dropped path no longer exists, show a concise inline error and keep the app usable.
- If opening an item fails, show a concise inline error.
- If multiple items are dropped, add all valid items and report any failures.

## Testing

Automated tests should cover:

- Default categories render in order.
- Dragged paths are auto-routed to Software, Files, or Folders.
- Files and folders render in details view with Name and Modified Time columns.
- Clicking each column header toggles sorting.
- Software items render as icons.
- Tauri window config remains borderless and transparent.

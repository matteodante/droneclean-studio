# Projects

The projects page (`/projects`) is the editor's home: the list of projects in the workspace folder, the ways to
create, import, edit, duplicate and delete one, and the workspace folder itself.

### DroneClean Studio logo
- Where: Projects page › header
- Does: Reloads the projects page.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### Language
- Where: Projects page › header
- Does: Switches the interface language and remembers the choice.
- SDK: `none`
- Code: `src/shared/ui/language-switcher.tsx`

### Docs
- Where: Projects page › header
- Does: Opens the built-in user guide.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### Discord
- Where: Projects page › header
- Does: Opens the community chat in a new tab.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### GitHub
- Where: Projects page › header
- Does: Opens the project's public source page in a new tab.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### Workspace folder
- Where: Projects page › header › Workspaces
- Does: Shows the active workspace folder and opens the list of known workspaces.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-indicator.tsx`

### Switch
- Where: Projects page › header › Workspaces popover
- Does: Makes another known folder the active workspace and reloads the editor with it.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-indicator.tsx`

### Remove workspace
- Where: Projects page › header › Workspaces popover
- Does: Forgets a workspace folder; the files on disk are left alone.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-indicator.tsx`

### Add workspace...
- Where: Projects page › header › Workspaces popover
- Does: Picks another folder as a workspace and makes it active.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-indicator.tsx`

### Import Project
- Where: Projects page › header
- Does: Opens a `.freecut.zip` project bundle and asks where to extract its media.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### New Project
- Where: Projects page › header
- Does: Opens the page that creates a project.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### Search projects...
- Where: Projects page › project list › filter bar
- Does: Filters the list by project name as the user types.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### All Resolutions
- Where: Projects page › project list › filter bar
- Does: Filters the list to projects of one canvas size, or shows every size.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### All FPS
- Where: Projects page › project list › filter bar
- Does: Filters the list to projects of one frame rate, or shows every rate.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### Sort by
- Where: Projects page › project list › filter bar
- Does: Sorts the list by name, last modified, date created or resolution.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### Ascending / Descending
- Where: Projects page › project list › Sort by menu
- Does: Reverses the direction of the chosen sort.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### Clear Filters
- Where: Projects page › project list › filter bar
- Does: Removes the search text and both filters.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### {count} selected
- Where: Projects page › project list › selection bar
- Does: Shows how many projects are selected in the list.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### Clear
- Where: Projects page › project list › selection bar
- Does: Deselects every project in the list.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### Delete {count}
- Where: Projects page › project list › selection bar
- Does: Moves the selected projects to the trash after a confirmation.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### Create your first project
- Where: Projects page › empty list
- Does: Opens the page that creates a project.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### Import an existing project
- Where: Projects page › empty list
- Does: Opens a project bundle from disk.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### No projects found
- Where: Projects page › project list
- Does: Says that no project matches the current search and filters.
- SDK: `none`
- Code: `src/features/projects/components/project-list.tsx`

### Project card
- Where: Projects page › project list
- Does: Shows a project's thumbnail, name, size and frame rate; a click selects it, a double-click opens it in the editor.
- SDK: `studio.project.open`
- Code: `src/features/projects/components/project-card.tsx`

### Project menu
- Where: Projects page › project card › ⋯ button
- Does: Opens the actions for one project: open, edit settings, duplicate, delete.
- SDK: `none`
- Code: `src/features/projects/components/project-card.tsx`

### Open in Editor
- Where: Projects page › project card › menu
- Does: Opens the project in the editor.
- SDK: `studio.project.open`
- Code: `src/features/projects/components/project-card.tsx`

### Edit Settings
- Where: Projects page › project card › menu
- Does: Opens the project's name, description, frame rate and resolution in a dialog.
- SDK: `studio.project.set`
- Code: `src/features/projects/components/project-card.tsx`

### Duplicate
- Where: Projects page › project card › menu
- Does: Copies the project, media included, under the name “<name> (Copy)”.
- SDK: `none`
- Code: `src/features/projects/components/project-card.tsx`

### Delete
- Where: Projects page › project card › menu
- Does: Asks for confirmation, then moves the project to the trash.
- SDK: `none`
- Code: `src/features/projects/components/project-card.tsx`

### Also delete local files on disk
- Where: Projects page › Delete Project dialog
- Does: Also removes the files in the project's linked folder; cannot be undone.
- SDK: `none`
- Code: `src/features/projects/components/project-card.tsx`

### Delete Project
- Where: Projects page › Delete Project dialog
- Does: Confirms the deletion and moves the project to the trash.
- SDK: `none`
- Code: `src/features/projects/components/project-card.tsx`

### Trash
- Where: Projects page › below the project list
- Does: Lists the deleted projects and shows how long they are kept before they disappear for good.
- SDK: `none`
- Code: `src/features/projects/components/trash-section.tsx`

### Empty trash
- Where: Projects page › Trash
- Does: Permanently deletes every project in the trash after a confirmation.
- SDK: `none`
- Code: `src/features/projects/components/trash-section.tsx`

### Restore
- Where: Projects page › Trash › project row
- Does: Puts a trashed project back in the project list.
- SDK: `none`
- Code: `src/features/projects/components/trash-section.tsx`

### Delete forever
- Where: Projects page › Trash › project row
- Does: Permanently deletes one trashed project after a confirmation.
- SDK: `none`
- Code: `src/features/projects/components/trash-section.tsx`

### Project Name
- Where: New Project page › Project Details
- Does: The project's name; required, at most 100 characters.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-form.tsx`

### Description
- Where: New Project page › Project Details
- Does: A free-text note about the project, at most 500 characters.
- SDK: `none`
- Code: `src/features/projects/components/project-form.tsx`

### Frame Rate
- Where: New Project page › Project Details
- Does: The project's frame rate: 24, 25, 30, 50 or 60 fps.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-form.tsx`

### Resolution
- Where: New Project page › Resolution
- Does: The canvas size and starting frame rate, chosen from seven named presets or a custom size.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-template-picker.tsx`

### YouTube 1080p
- Where: New Project page › Resolution
- Does: Sets a 1920×1080, 16:9 canvas at 30 fps.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-template-picker.tsx`

### Shorts / TikTok / Reels
- Where: New Project page › Resolution
- Does: Sets a 1080×1920, 9:16 vertical canvas at 30 fps.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-template-picker.tsx`

### Instagram Square
- Where: New Project page › Resolution
- Does: Sets a 1080×1080, 1:1 canvas at 30 fps.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-template-picker.tsx`

### Instagram Portrait
- Where: New Project page › Resolution
- Does: Sets a 1080×1350, 4:5 canvas at 30 fps.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-template-picker.tsx`

### Twitter/X
- Where: New Project page › Resolution
- Does: Sets a 1200×675, 16:9 canvas at 30 fps.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-template-picker.tsx`

### LinkedIn
- Where: New Project page › Resolution
- Does: Sets a 1200×627 canvas at 30 fps.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-template-picker.tsx`

### Custom Size
- Where: New Project page › Resolution
- Does: Reveals the width and height fields for any canvas size.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-template-picker.tsx`

### Width (px)
- Where: New Project page › Resolution › Custom Size
- Does: The canvas width, from 320 to 7680 pixels.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-form.tsx`

### Height (px)
- Where: New Project page › Resolution › Custom Size
- Does: The canvas height, from 240 to 4320 pixels.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-form.tsx`

### Create Project
- Where: New Project page › footer
- Does: Makes the project and opens it in the editor.
- SDK: `studio.project.create`
- Code: `src/features/projects/components/project-form.tsx`

### Cancel
- Where: New Project page › footer
- Does: Leaves the page without creating a project.
- SDK: `none`
- Code: `src/features/projects/components/project-form.tsx`

### Edit Project
- Where: Projects page › Edit Project dialog
- Does: Changes the name, description, frame rate and canvas size of an existing project.
- SDK: `studio.project.set`
- Code: `src/features/projects/components/project-form.tsx`

### Update Project
- Where: Projects page › Edit Project dialog
- Does: Saves the changed project settings.
- SDK: `studio.project.set`
- Code: `src/features/projects/components/project-form.tsx`

### Destination Folder
- Where: Import Project dialog
- Does: Chooses where the imported bundle's media is extracted.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### Create in FreeCutProjects subfolder
- Where: Import Project dialog
- Does: Extracts the media inside a `FreeCutProjects` folder created in the chosen destination.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### Start Import
- Where: Import Project dialog › footer
- Does: Validates, extracts and links the bundle, then opens the imported project.
- SDK: `none`
- Code: `src/routes/projects/index.lazy.tsx`

### Pick your workspace folder
- Where: Workspace gate
- Does: Explains that DroneClean Studio keeps every project and cache as plain files in a folder the user controls.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-gate-splash.tsx`

### Choose folder
- Where: Workspace gate
- Does: Opens the system folder picker and makes the chosen folder the workspace.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-gate-splash.tsx`

### Workspace guide
- Where: Workspace gate
- Does: Opens the guide page that explains what a workspace folder is.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-gate-splash.tsx`

### Reconnect your workspace
- Where: Workspace gate, when the saved folder lost permission
- Does: Asks for read/write access to the saved workspace folder again.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-gate-splash.tsx`

### Choose a different folder
- Where: Workspace gate › Reconnect
- Does: Replaces the saved workspace folder with another one.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-gate-splash.tsx`

### Reconnect
- Where: Workspace gate › Reconnect
- Does: Requests permission for the saved folder and reopens the projects.
- SDK: `none`
- Code: `src/features/workspace-gate/workspace-gate-splash.tsx`

### Legacy projects found
- Where: Projects page › banner
- Does: Offers to copy projects that live in the browser's old storage into the workspace folder.
- SDK: `none`
- Code: `src/features/projects/components/legacy-migration-banner.tsx`

### Migrate
- Where: Projects page › Legacy projects found
- Does: Copies the old projects, media and transcripts into the workspace folder.
- SDK: `none`
- Code: `src/features/projects/components/legacy-migration-banner.tsx`

### Later
- Where: Projects page › Legacy projects found
- Does: Dismisses the migration offer until the page is opened again.
- SDK: `none`
- Code: `src/features/projects/components/legacy-migration-banner.tsx`

### Delete legacy storage
- Where: Projects page › Legacy migration banner
- Does: Removes the old browser storage once its projects are in the workspace folder.
- SDK: `none`
- Code: `src/features/projects/components/legacy-migration-banner.tsx`

### Get the desktop app
- Where: Projects page › desktop app notice (web editor only)
- Does: Opens the download options for the desktop app in a new tab.
- SDK: none (view only)
- Code: `src/studio/web/desktop-app-notice.tsx`

### Dismiss desktop app notice
- Where: Projects page › desktop app notice (web editor only)
- Does: Hides the notice and remembers it in this browser.
- SDK: none (view only)
- Code: `src/studio/web/desktop-app-notice.tsx`
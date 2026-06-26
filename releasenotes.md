# Release Notes - Nagios Stream Deck Plugin

This document outlines the changes, new features, and bug fixes for each version of the Nagios Stream Deck Plugin.

## [v0.3.0.0] - 2026-06-26

### Added
- **Default entityType Fallback**: The plugin now defaults to `"host"` when `entityType` is undefined (such as on newly added buttons), preventing the button from being stuck in the gray "Setup UI" state.
- **Improved Settings Initialization**: The Property Inspector now immediately writes default configuration values (`entityType`, `interval`, `warnThreshold`, etc.) to the settings storage on initial load.

### Fixed
- **Dropdown refresh on Entity Type change**: Changing the entity type to "Service" now correctly and immediately populates the service dropdown list.
- **Detailed query crashes fallback**: Added a robust fallback query mechanism for service descriptions containing slash characters `/` (which cause Nagios Core's `statusjson.cgi?query=service` to crash with HTTP 500), retrieving the status from the host's servicelist instead.
- **Duration normalizations**: Normalized duration timestamp calculation by dynamically identifying and handling 10-digit (seconds) vs 13-digit (milliseconds) Unix timestamps.
- **Credentials preservation**: Fixed an issue where saving settings in the Property Inspector would overwrite credentials, causing the backend polling to lose authentication details.

---

## [v0.2.6.0] - 2026-06-25

### Added
- **Interactive Simulator**: Created a high-fidelity plugin settings and key simulator `simulator.html` to run the plugin configuration panel directly in any browser for testing and validation.
- **Walkthrough Demonstration Recording**: Generated a full animated walkthrough demo (`nagios_plugin_demo.webp`) showing all key features, available in the repository root.

### Changed
- **Sleek SVG Branding Icons**: Replaced default/generic template category and action PNG icons with custom SVG vector icons, matching Elgato's monochromatic transparent white stroke guidelines (Category: `category-icon.svg`, Action: `icon.svg`, default key: `key.svg`). Deleted all conflicting legacy PNG files.

---

## [v0.2.5] - 2026-06-20

### Changed
- **Automated GitHub releases**: Pushing a version tag now triggers a GitHub Actions workflow (`.github/workflows/release.yml`) that builds the plugin, packages it, extracts the matching release notes section, and publishes a GitHub release with the `.streamDeckPlugin` binary attached — no manual steps required beyond uploading to the Elgato Maker Console.
- **Simplified release wizard**: `scripts/release.cjs` now handles only the version bump, commit, tag, and push. Build, packaging, and release creation are delegated to GitHub Actions.
- **Installation link**: README now points to the GitHub Releases page for downloading the plugin instead of the repository root.
- **Walkthrough updated**: Release & Versioning Workflow section reflects the new two-step release process.

---

## [v0.2.4] - 2026-06-20

### Fixed
- **Property Inspector blank after fix in v0.2.3**: The `sendToPropertyInspector` subscribe callback was not declared `async`, causing a syntax error that prevented the entire script from parsing and left the PI empty.
- **Button settings still lost on reopen**: `streamDeckClient.getSettings()` has an unavoidable timing race in the PI — it can return `{}` before the Stream Deck WebSocket has delivered the persisted `didReceiveSettings` event, even on a retry. Fixed by having the plugin echo the full action settings back in the `hosts_services_list` payload, which the PI then merges into `activeSettings` before populating the form. The plugin-side `ev.action.getSettings()` is always reliable since the plugin is a persistent process.

---

## [v0.2.3] - 2026-06-20

### Fixed
- **Duration labels always showed near-zero values**: `formatDuration` received Nagios Unix timestamps in seconds but divided by 1000, so a 1-hour outage showed as `"3s"`. Fixed by treating both timestamps as seconds directly.
- **Wrong host status on non-UP hosts**: `isStandard` detection used `rawStatus === 0` (UP only). A DOWN host in standard-code Nagios showed as PENDING; UNREACHABLE showed as UP. Detection now also covers the unambiguous standard-only code `3` (PENDING).
- **Wrong service status on all-WARNING/CRITICAL hosts**: The `isStandard` heuristic scanned the service list for status `0` or `3`. If every service on the host was WARNING or CRITICAL, no match was found, causing WARNING to display as PENDING and CRITICAL to display as OK. Reverted to the direct `query=service&servicedescription=Y` endpoint, which avoids the ambiguity entirely and eliminates the over-fetch of all host services per poll cycle.
- **SVG rendering broken for host/service names containing `&`, `<`, or `>`**: Names were interpolated raw into SVG XML. Added XML escaping to all three draw functions.
- **Property Inspector settings not restored on reopen**: `getSettings()` was called immediately when the Stream Deck client library loaded, before the underlying WebSocket had delivered the persisted `didReceiveSettings` message. Added a fallback re-fetch inside the `hosts_services_list` handler so settings are retried once the connection is confirmed active.
- **Credentials not persisted when PI closed quickly**: `updateActionSettings` was called without `await` in the `hosts_services_list` handler. If the property inspector was closed before the promise resolved, the URL/credentials were lost from action settings.
- **Stale hostgroup/servicegroup survived "Change Server"**: The disconnect button only cleared `url`, `username`, `password`, `hostName`, and `serviceName`. `hostgroup` and `servicegroup` were left in settings, causing the plugin to silently query non-existent groups on the new server. Both are now cleared on disconnect.
- **Threshold of 0% saved as 99%**: `parseFloat(input.value) || 99.0` treated a deliberately entered threshold of `0` as falsy. Replaced with `Number.isFinite(val) ? val : 99.0`.
- **Duplicate `hostServiceMap`-building code**: The service-list traversal loop appeared verbatim in two plugin handlers. Extracted to a shared `buildHostServiceMap()` helper.

---

## [v0.2.1] - 2026-06-19

### Fixed
- **HTTP 500 / Offline errors on Service Totals**:
  - Replaced heavy detailed query APIs (`query=servicelist&details=true` and `query=hostlist&details=true`) with lightweight, pre-aggregated count APIs (`query=servicecount` and `query=hostcount`) for filtered totals.
  - Bypasses the Nagios Core CGI details generation bug that causes memory limits/crashes on group-filtered status requests.
  - Bypasses unnecessary client-side status code mapping and traversal on group lists for improved efficiency.

---

## [v0.2.0] - 2026-06-18

### Added
- **Background Status Graphs**:
  - Draw a beautiful, subtle sparkline graph in the background of button keys showing status history over time.
  - Available for all monitored types (Hosts, Services, Host Totals, Service Totals).
  - Configurable duration (from 5 minutes up to 24 hours, default 60 min) adjustable directly in the Property Inspector.
  - Active background polling that continues to collect status metrics even when the button is off-screen/hidden, while pausing SVG rendering to optimize performance.
  - History is automatically reset if button monitored entity configuration is modified.

---

## [v0.1.0] - 2026-06-18

### Added
- **Host & Service Monitoring**: Easily monitor the status of individual hosts and services directly on your Stream Deck buttons.
- **Host & Service Totals**:
  - Displays overall availability percentage (with one decimal point) and status ratios (e.g. `UP: 145/146`, `OK: 961/965`).
  - Configurable Warning and Critical thresholds (in percent) in the Property Inspector to dynamically change key colors (Green, Yellow, Red).
- **Group-Scoped Totals**:
  - Filter host totals and service totals by a specific **Hostgroup** or **Servicegroup**.
  - Dropdowns dynamically fetch and display groups from your Nagios instance using `objectjson.cgi`.
  - Mutually exclusive selection controls for Hostgroup & Servicegroup dropdowns to prevent query conflicts.
- **Action Links (Browser Integration)**:
  - Pressing a button opens the corresponding host or service extended information page (`extinfo.cgi`) in your default browser.
  - Pressing a Totals button opens the general Host Status or Service Status overview page.
  - If a Totals button is filtered by a group, it opens the group-specific filtered status view.
- **Smart Text Layouts**: Auto-splits long entity names on the button when containing `" - "`, space, dash, or underscore separators for clean multi-line display.
- **High-Performance Scaling**: Queries `tac.cgi` (Tactical Overview) for global totals instead of detailed list APIs to prevent HTTP 500 timeouts and memory exhaustion on heavy Nagios instances.
- **Marketplace Branding**: Included premium marketing assets in the `marketing/` folder, including a custom high-contrast icon, cover thumbnail, and detailed key status screenshots.

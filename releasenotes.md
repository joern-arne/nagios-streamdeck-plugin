# Release Notes - Nagios Stream Deck Plugin

This document outlines the changes, new features, and bug fixes for each version of the Nagios Stream Deck Plugin.

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

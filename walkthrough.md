# Walkthrough - Nagios Stream Deck Plugin

We have successfully created a Stream Deck plugin from scratch that monitors Nagios Core host and service statuses. Below is a summary of what has been implemented and how to run it.

## Changes Made

### 1. Codebase Relocation
All scaffolded plugin files, dependencies, and configuration templates were moved from the nested `/nagios` folder to the repository root.

### 2. Manifest Configuration
Updated [manifest.json](com.joern-arne.nagios.sdPlugin/manifest.json):
- Action UUID changed to `com.joern-arne.nagios.status`.
- Action Name set to `Status Monitor`.
- Tooltip changed to `Displays Nagios host or service status.`.
- Property Inspector HTML path set to `ui/status.html`.
- State default icon changed to `imgs/actions/status/key`.
- Category set to `Status Monitor for Nagios`.
- Description and UUID configured properly.

### 3. Action Logic (Plugin Backend)
Created [nagios-status.ts](src/actions/nagios-status.ts):
- Handles the WebSocket communication with the Stream Deck app.
- Manages action instances' polling schedules when visible (`onWillAppear`/`onWillDisappear`).
- Reschedules polling when action settings change (`onDidReceiveSettings`).
- Responds to Property Inspector events:
  - `connect`: Validates the connection to Nagios, returns hosts and services data, and saves credentials globally.
  - `fetch_hosts_services`: Fetches lists of hosts and services using stored credentials.
- Polls Nagios Core's `statusjson.cgi` for the selected host/service status.
- **Corrected Status Mapping**: Status integers returned by `statusjson.cgi` represent bitmask flags rather than standard plugin exit codes. We updated the status mapping logic to match Nagios Core specifications (Hosts: `2` = UP, `4` = DOWN, `8` = UNREACHABLE; Services: `2` = OK, `4` = WARNING, `16` = CRITICAL, `8` = UNKNOWN).
- **Auto Line Splitting**: If the host or service name contains the `" - "` substring, the name is split at the dash and drawn as two lines of text on the button to improve readability.
- **Browser Open on Keypress**: Overrides `onKeyDown` to build the correct Nagios extended info (`extinfo.cgi`) page link for the host or service and open it instantly in the user's default browser. For Host Totals and Service Totals, it opens the main Host Status or Service Status overview page. If filtered by a hostgroup or servicegroup, it opens the corresponding group-filtered status page (e.g., `status.cgi?hostgroup=X`).
- **Host Totals & Service Totals (Optimized tac.cgi Parsing)**: Instead of querying the heavy and slow detailed JSON status lists (which cause memory exhaustion and **HTTP 500 Internal Server Errors** on installations with hundreds/thousands of services), the plugin queries the lightweight, server-side aggregated `tac.cgi` (Tactical Overview) page (~13 KB). It extracts the exact status counts (Up/Down/Unreachable/Pending for hosts; Ok/Warning/Critical/Unknown/Pending for services) using robust regex patterns, computing overall availability percentage and displaying totals (e.g. `UP: 145/146` or `OK: 961/965`) instantly.
- **Hostgroup & Servicegroup Filtering**: For totals views, allows filtering the counts by a selected Hostgroup or Servicegroup using `statusjson.cgi` with `&hostgroup=GROUP` or `&servicegroup=GROUP` queries (which run efficiently for smaller group sizes). Fallback to global `tac.cgi` parsing is maintained for overall totals.
- **Custom Thresholds**: Allows configuring Warning and Critical thresholds in percent for the totals options in the Property Inspector. Buttons turn Green, Yellow, or Red automatically based on these thresholds.
- Generates dynamic, highly styled, status-colorized SVG icons on the fly using base64 rendering, showing the entity name, status value/percentage, and details.

### 4. Property Inspector (UI Settings Panel)
Created [status.html](com.joern-arne.nagios.sdPlugin/ui/status.html):
- A tab/card-based dark UI matching the native Stream Deck styling.
- **Connection Panel**: Input fields for Nagios URL, Username, and Password, alongside a validation connection handler showing errors.
- **Settings Panel**: Shows connection status, Entity Type select (Host, Service, Host Totals, or Service Totals), a dynamically-populated Host select list, a dynamically-populated Service select list (filtered by the selected host), customizable Threshold fields (shown only when Host/Service Totals are selected), and dropdown selectors for **Hostgroups** and **Servicegroups** (populated via `objectjson.cgi`).
- **Group Select Behavior**: The Hostgroup dropdown is visible for both Host Totals and Service Totals. The Servicegroup dropdown is only visible for Service Totals. Changing the Hostgroup filter in Service Totals clears the Servicegroup selection, and vice-versa, to ensure mutually exclusive queries.
- Integrates with the backend plugin to save credentials and configurations instantly upon modification.

---

## Build & Validation Results

### Compiling typescript
We ran `make build` (or `npm run build`) to compile the TS files:
```bash
make build
```
Result: `created com.joern-arne.nagios.sdPlugin/bin/plugin.js in 1.1s` (no errors).

### Compliance Validation
We ran the official Elgato plugin validator:
```bash
npx @elgato/cli validate com.joern-arne.nagios.sdPlugin
```
Result: `✔ Validation successful` (0 errors, 0 warnings).

---

## Packaging & Distribution

### 1. App Icon Assets
We created a modern, high-contrast, glowing neon green crosshair icon representing Nagios monitoring in a sleek Stream Deck key, formatted at the required resolutions:
- [marketplace.png](com.joern-arne.nagios.sdPlugin/imgs/plugin/marketplace.png) (288x288 pixels)
- [marketplace@2x.png](com.joern-arne.nagios.sdPlugin/imgs/plugin/marketplace@2x.png) (576x576 pixels)

### 2. Marketplace Listing Assets
We generated professional, high-resolution screenshots and marketing graphics showing example button values, saved to the `marketing/` folder:
- [marketplace_thumbnail.png](marketing/marketplace_thumbnail.png) (1024x1024 pixels) - A sleek marketing cover showing a Stream Deck with green, yellow, and red status totals.
- [gallery_host_totals.png](marketing/gallery_host_totals.png) (1024x1024 pixels) - A close-up view of a green "Host Totals" key showing `UP: 145/146` and `99.3%` availability.
- [gallery_service_totals.png](marketing/gallery_service_totals.png) (1024x1024 pixels) - A close-up view of a warning-yellow "Service Totals" key showing `WARN: 4/965` and `99.5%` availability.
- [gallery_critical_group.png](marketing/gallery_critical_group.png) (1024x1024 pixels) - A close-up view of a critical-red "DB Group" totals key showing `CRIT: 1/36` and `97.2%` availability.

### 3. Packaging the Plugin
To bundle the plugin into the official Stream Deck installer package (`.streamDeckPlugin`):
```bash
make pack   # Or: npx @elgato/cli pack com.joern-arne.nagios.sdPlugin --force
```
This produces the final distribution file:
- **`com.joern-arne.nagios.streamDeckPlugin`** in the repository root.

---

## Release & Versioning Workflow

We have provided an automated release wizard script at [scripts/release.cjs](scripts/release.cjs). You can run it directly using the Makefile:

```bash
make release
```

### What the Release Wizard Does:
1. **Verifies Git Cleanliness**: Ensures you don't have uncommitted changes in your repository.
2. **Prompts for New Version**: Asks you to input the new version number in the required `X.Y.Z.W` format (e.g. `0.1.1.0`).
3. **Updates Manifest**: Automatically parses and modifies the `Version` field in [manifest.json](com.joern-arne.nagios.sdPlugin/manifest.json).
4. **Commits Version Bump**: Stages and commits the updated manifest file.
5. **Tags the Commit**: Creates an annotated Git tag (e.g. `v0.1.1.0`) on the version bump commit.
6. **Builds & Packages**: Compiles the source files and packages the final `com.joern-arne.nagios.streamDeckPlugin` installer.

### Final Steps After Running the Wizard:
1. Review your [releasenotes.md](releasenotes.md) file to log changes.
2. Push your changes and tags to the remote repository:
   ```bash
   git push origin main --tags
   ```
3. Log in to the [Elgato Maker Console](https://marketplace.elgato.com/) and upload the generated `com.joern-arne.nagios.streamDeckPlugin` installer.

---

## How to Run & Test the Plugin Locally

### 1. Direct Installation
Double-click the generated `com.joern-arne.nagios.streamDeckPlugin` installer. This will open the Stream Deck app and automatically import/install the plugin.

### 2. Developer Linking (Simulating Development)
To register the directory directly with Stream Deck without installing a packed package:
```bash
make link   # Or: npx @elgato/cli link com.joern-arne.nagios.sdPlugin
```

### 3. Run in Development Mode
During development, you can start the watch process, which will rebuild the plugin and restart the Stream Deck instance automatically whenever code changes:
```bash
make watch  # Or: npm run watch
```
*(Make sure the Stream Deck app is running on your Mac/Windows system)*

### 4. Setup Buttons in Stream Deck App
1. Open the Elgato Stream Deck app.
2. In the right-hand action list, scroll down to find the **Nagios Status** category.
3. Drag the **Nagios Status** action onto any empty button slot.
4. The button will prompt you to set up the connection:
   - Provide your **Nagios Base URL** (e.g., `https://nagios.example.com/nagios`).
   - Fill in your **Basic Auth Username and Password**.
   - Click **Connect**.
5. Once connected, select whether you want to monitor a **Host** or **Service**, or show **Host Totals** / **Service Totals**.
6. The button on your Stream Deck device will instantly update to show the status, availability, and color (green for UP/OK, yellow for Warning, red for Down/Critical, grey for Unreachable/Unknown/Offline).

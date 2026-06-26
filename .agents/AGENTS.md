# Rules and Guidelines for Nagios Stream Deck Plugin

This document outlines the design principles, architectural constraints, and coding standards for agent interaction with this repository.

## Workspace Skills

The following custom skills are defined for this project under `.agents/skills/`. Agents should use the `view_file` tool to read the instructions for these skills when performing relevant tasks:

- **[nagios-cgi-integration](file:///Users/joern/git/github.com/joern-arne/nagios-streamdeck-plugin/.agents/skills/nagios-cgi-integration/SKILL.md)**: Guidelines and recipes for querying Nagios Core CGIs robustly, parsing status data, and handling query crashes on slash characters.
- **[streamdeck-property-inspector](file:///Users/joern/git/github.com/joern-arne/nagios-streamdeck-plugin/.agents/skills/streamdeck-property-inspector/SKILL.md)**: State management, credentials preservation, and settings synchronization best practices in Elgato Stream Deck Property Inspectors.


## Clean Code & Architecture
* Follow clean coding principles (SOLID, meaningful naming, small single-responsibility functions).
* Enforce a clear separation of concerns (e.g., Controllers/Handlers -> Services -> Repositories/Data).

## Technical Debt & Quality Controls
* Technical debt must be kept at 0%. Do not leave `TODO` items, unhandled errors, or dead code blocks.


## Build and Testing

- **Compilation**: Build the TypeScript code using `npm run build` or `make build`. The entry point is `src/plugin.ts`, which compiles to `com.joern-arne.nagios.sdPlugin/bin/plugin.js`.
- **Validation**: Validate the plugin configuration using `npx @elgato/cli validate com.joern-arne.nagios.sdPlugin`.
- **Packaging**: Pack the plugin for distribution using `make pack` or `npx @elgato/cli pack com.joern-arne.nagios.sdPlugin --force`.
- **Node.js Environment**: The project targets Node.js 20. Use built-in features such as global `fetch` rather than importing external fetching libraries like `node-fetch`.

## Nagios Core Integration Guidelines

- **Performant Queries**: Nagios Core query endpoints (like `query=servicelist&details=true` or `query=hostlist&details=true`) are heavy and can trigger memory exhaustion or HTTP 500 errors on large-scale environments.
  - For totals overviews, use lightweight counting queries (`query=servicecount` or `query=hostcount`) or parse `tac.cgi` directly.
  - When querying a host's services list, use `query=servicelist&hostname=<HOST>` without detail parameters to retrieve the lightweight status map.
- **Handling Nagios CGI Crashes**:
  - The single service query `statusjson.cgi?query=service` is prone to crashes (segmentation fault / HTTP 500) if the service name contains a slash character `/` (e.g., `cleo /health`).
  - If a single service query fails or is known to crash, always fallback to `query=servicelist&hostname=<HOST>` to extract the status value from the host list. If details (like `last_state_change`) are missing in this list, default them safely (e.g. status duration as `N/A`).
- **Timestamp Handling**:
  - Nagios Core timestamps (e.g. `query_time`, `last_state_change`) can be returned as either 10-digit (seconds) or 13-digit (milliseconds) Unix timestamps depending on query configuration.
  - Always normalize timestamps to seconds (e.g., by checking if `value > 9999999999`) before performing duration computations.

## Property Inspector (UI) Rules

- **Credentials Preservation**:
  - When the user changes settings (e.g., entity type, hostgroup, warn/crit thresholds) in `status.html`, the Property Inspector must preserve the credentials (`url`, `username`, `password`) in `activeSettings` to prevent them from being overwritten with empty values.
  - The backend plugin `startPolling()` must support falling back to global settings asynchronously if credentials are not present in local action settings.
- **Dynamic Field Updates**:
  - When the entity type is changed to `"service"`, immediately call `populateServices()` to populate the service dropdown list for the currently selected host, rather than waiting for a host change event.

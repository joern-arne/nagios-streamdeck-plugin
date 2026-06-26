---
name: nagios-cgi-integration
description: Guidelines and recipes for querying Nagios Core CGIs robustly, parsing status data, and handling server-side limitations/crashes.
---

# Nagios Core CGI Integration Skill

This skill contains instructions, troubleshooting recipes, and best practices for integrating with Nagios Core CGI endpoints (`statusjson.cgi`, `objectjson.cgi`, `tac.cgi`, `extinfo.cgi`).

## Query Optimization (Large Environments)
- **Problem**: Querying detailed service/host lists using `query=servicelist&details=true` is slow and can exhaust memory or trigger HTTP 500 errors on the Nagios server.
- **Solution**:
  - For total counts/overview availability, use lightweight counts (`query=servicecount` or `query=hostcount`) or parse `tac.cgi` directly.
  - To get a list of services on a host without crashing or overloading, query `query=servicelist&hostname=<HOST>` without detail parameters.

## Handling CGI Crashes (Slash `/` in Names)
- **Problem**: The single service detail query (`statusjson.cgi?query=service&hostname=X&servicedescription=Y`) crashes with an HTTP 500 error if the service name contains a slash character `/` (e.g. `cleo /health`).
- **Solution**:
  - Always execute single service status queries inside a try-catch block.
  - On failure, fall back to querying the host's basic service list: `statusjson.cgi?query=servicelist&hostname=<HOST>`.
  - Extract the status from the returned object map. Since this list does not contain detail timestamps, return `0` or safe defaults for fields like `last_state_change` (which translates to `N/A` duration).

## Timestamp Normalization
- **Problem**: Nagios timestamps (e.g. `query_time`, `last_state_change`) can be returned as 10-digit (seconds) or 13-digit (milliseconds) integers depending on the version and configuration.
- **Solution**:
  - Normalize timestamps before performing duration math:
    ```javascript
    const normalizeToSeconds = (val) => val > 9999999999 ? Math.floor(val / 1000) : val;
    ```

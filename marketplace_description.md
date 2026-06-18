# Status Monitor for Nagios — Stream Deck Marketplace Description

Copy and paste the following content into your product listing in the Elgato Maker Console.

---

## Short Description
Bring Nagios Core monitoring directly to your Stream Deck. Monitor hosts, services, tactical totals, and group availabilities with real-time status indicators and quick web actions.

---

## Long Description

Monitor your infrastructure at a glance with **Status Monitor for Nagios** for Stream Deck. Whether you are managing a few local machines or a massive enterprise network, this plugin puts real-time server health and service statuses right at your fingertips.

No more constantly switching tabs or checking dashboards—your Stream Deck keys will dynamically update color and text based on actual Nagios metrics, allowing you to catch issues before they escalate.

### Key Features
* 🟢 **Real-Time Status Indicators**: Monitor individual hosts or services with color-coded buttons (Green for UP/OK, Yellow for Warning, Red for Down/Critical, Grey for Unreachable/Unknown).
* 📊 **Tactical Totals**: Display overall network availability percentages and success ratios (e.g. `UP: 145/146` or `OK: 961/965`) directly on a single key.
* 🏷️ **Group-Scoped Monitoring**: Limit totals monitoring to a specific **Hostgroup** or **Servicegroup** using easy-to-use dropdown menus.
* ⚙️ **Custom Alerts & Thresholds**: Set personalized Warning and Critical percentage thresholds for your Totals keys to trigger Yellow or Red alerts instantly.
* ⚡ **One-Press Quick Actions**: Press any key to open the corresponding Nagios configuration page, extended status info, or group overview in your default browser.
* 🚀 **Engineered for Scale**: Built with performance in mind. Queries are optimized to fetch lightweight tactical overviews (`tac.cgi`) for global summaries, preventing HTTP 500 errors and timeout issues even on large-scale infrastructure environments.
* 📝 **Smart Text Formatting**: Automatically wraps long host or service names to fit beautifully onto the Stream Deck keys.

### Getting Started is Easy:
1. Drag the **Status Monitor** action onto an empty slot on your Stream Deck.
2. In the Property Inspector, enter your **Nagios Base URL** (e.g., `https://your-monitoring-server/nagios`).
3. Enter your **Basic Auth Username and Password**, and click **Connect**.
4. Choose your entity type (Host, Service, Host Totals, or Service Totals) and configure your thresholds or groups.
5. Your Stream Deck is now connected to your active Nagios Core server!

### Compatibility:
* Works with **Nagios Core 3.x / 4.x**
* Supports basic authentication.

---

*Disclaimer: Nagios and Nagios Core are registered trademarks of Nagios Enterprises, LLC. This plugin is an independent, community-driven open-source project under the MIT License and is not officially affiliated with, sponsored by, or endorsed by Nagios Enterprises, LLC.*

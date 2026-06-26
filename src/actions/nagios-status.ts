import { action, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

/**
 * Settings for Nagios Status action.
 */
type NagiosSettings = {
	url?: string;
	username?: string;
	password?: string;
	entityType?: "host" | "service" | "host_totals" | "service_totals";
	hostName?: string;
	serviceName?: string;
	hostgroup?: string;
	servicegroup?: string;
	interval?: number; // update interval in seconds
	warnThreshold?: number;
	critThreshold?: number;
	showGraph?: boolean;
	graphDuration?: number; // in minutes
};

// Helper to get basic-auth header
function getHeaders(settings: NagiosSettings) {
	const creds = `${settings.username}:${settings.password}`;
	const base64 = Buffer.from(creds).toString("base64");
	return {
		"Authorization": `Basic ${base64}`,
		"Accept": "application/json"
	};
}

function escapeXml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHostServiceMap(services: Array<{ hostName?: string; serviceName?: string }>): Record<string, string[]> {
	const map: Record<string, string[]> = {};
	for (const s of services) {
		if (s.hostName && s.serviceName) {
			if (!map[s.hostName]) map[s.hostName] = [];
			if (!map[s.hostName].includes(s.serviceName)) {
				map[s.hostName].push(s.serviceName);
			}
		}
	}
	return map;
}

// Helper to parse servicelist structure, which can be an array of service objects
// or a nested map of hostName -> serviceName -> serviceObject
function getServicesFromList(servicelist: any): Array<{ hostName?: string; serviceName?: string; status: number; last_state_change?: number; last_hard_state_change?: number }> {
	const list: any[] = [];
	if (Array.isArray(servicelist)) {
		for (const item of servicelist) {
			if (item && typeof item === "object") {
				list.push({
					hostName: item.host_name || item.hostname,
					serviceName: item.service_description || item.description || item.service_name,
					status: item.status,
					last_state_change: item.last_state_change,
					last_hard_state_change: item.last_hard_state_change
				});
			}
		}
	} else if (servicelist && typeof servicelist === "object") {
		for (const hostName of Object.keys(servicelist)) {
			const hostServices = servicelist[hostName];
			if (Array.isArray(hostServices)) {
				for (const item of hostServices) {
					if (item && typeof item === "object") {
						list.push({
							hostName: hostName,
							serviceName: item.service_description || item.description || item.service_name,
							status: item.status,
							last_state_change: item.last_state_change,
							last_hard_state_change: item.last_hard_state_change
						});
					}
				}
			} else if (hostServices && typeof hostServices === "object") {
				for (const serviceName of Object.keys(hostServices)) {
					const item = hostServices[serviceName];
					if (item && typeof item === "object") {
						list.push({
							hostName: hostName,
							serviceName: serviceName,
							status: item.status,
							last_state_change: item.last_state_change,
							last_hard_state_change: item.last_hard_state_change
						});
					} else {
						list.push({
							hostName: hostName,
							serviceName: serviceName,
							status: typeof item === "number" ? item : Number(item) || 0
						});
					}
				}
			}
		}
	}
	return list;
}

// Helper to map standard service state codes to bitmask values
function getNormalizedServiceStatus(status: number, isStandard: boolean): number {
	if (isStandard) {
		if (status === 0) return 2; // OK
		if (status === 1) return 4; // WARNING
		if (status === 2) return 16; // CRITICAL
		if (status === 3) return 8; // UNKNOWN
		if (status === 4) return 1; // PENDING
	}
	return status;
}

// Helper to map standard host state codes to bitmask values
function getNormalizedHostStatus(status: number, isStandard: boolean): number {
	if (isStandard) {
		if (status === 0) return 2; // UP
		if (status === 1) return 4; // DOWN
		if (status === 2) return 8; // UNREACHABLE
		if (status === 3) return 1; // PENDING
	}
	return status;
}

// Helper to format duration — both arguments are Unix timestamps in seconds (as returned by Nagios statusjson.cgi)
function formatDuration(lastStateChangeRaw: number, queryTimeRaw: number): string {
	if (!lastStateChangeRaw || lastStateChangeRaw <= 0) return "N/A";

	const lastStateChangeSec = lastStateChangeRaw > 9999999999 ? Math.floor(lastStateChangeRaw / 1000) : lastStateChangeRaw;
	const queryTimeSec = queryTimeRaw > 9999999999 ? Math.floor(queryTimeRaw / 1000) : queryTimeRaw;

	let diffSeconds = Math.floor(queryTimeSec - lastStateChangeSec);
	if (diffSeconds < 0) diffSeconds = 0;
	
	const days = Math.floor(diffSeconds / 86400);
	diffSeconds %= 86400;
	const hours = Math.floor(diffSeconds / 3600);
	diffSeconds %= 3600;
	const minutes = Math.floor(diffSeconds / 60);
	const seconds = diffSeconds % 60;
	
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

@action({ UUID: "com.joern-arne.nagios.status" })
export class NagiosStatus extends SingletonAction<NagiosSettings> {
	private timers = new Map<string, NodeJS.Timeout>();
	private history = new Map<string, Array<{ time: number; value: number }>>();
	private lastEntityKey = new Map<string, string>();
	private visibleActions = new Set<string>();
	private cleanupTimers = new Map<string, NodeJS.Timeout>();
	private configCache: {
		timestamp: number;
		url: string;
		hostNames: string[];
		hostServiceMap: Record<string, string[]>;
		hostgroups: string[];
		servicegroups: string[];
	} | null = null;

	/**
	 * Stops the active polling timer for a specific action instance.
	 */
	private stopPolling(actionId: string) {
		const timer = this.timers.get(actionId);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(actionId);
		}
	}

	/**
	 * Starts the polling schedule for an action instance.
	 */
	private async startPolling(action: any, settings: NagiosSettings) {
		const entityKey = this.getEntityKey(settings);
		if (this.lastEntityKey.get(action.id) !== entityKey) {
			this.history.delete(action.id);
			this.lastEntityKey.set(action.id, entityKey);
		}

		this.stopPolling(action.id);

		let url = settings.url;
		let username = settings.username;
		let password = settings.password;

		if (!url || !username || !password) {
			try {
				const globalSettings = await streamDeck.settings.getGlobalSettings<any>();
				url = globalSettings.url;
				username = globalSettings.username;
				password = globalSettings.password;
			} catch (err) {
				streamDeck.logger.warn("Failed to fetch global settings in startPolling:", err);
			}
		}

		const entityType = settings.entityType || "host";
		const isTotals = entityType === "host_totals" || entityType === "service_totals";
		const hasConfig = url && username && password && (isTotals || settings.hostName);
		if (!hasConfig) {
			// Not configured yet, draw a neutral setup button
			if (this.visibleActions.has(action.id)) {
				this.drawConfigureState(action);
			}
			return;
		}

		const config = { ...settings, url, username, password };

		// Run the check immediately
		this.pollStatus(action, config);

		// Schedule periodic check
		const intervalSeconds = settings.interval || 30;
		const timer = setInterval(() => {
			this.pollStatus(action, config);
		}, intervalSeconds * 1000);

		this.timers.set(action.id, timer);
	}

	/**
	 * Queries the Nagios CGI for status.
	 */
	private async pollStatus(action: any, settings: NagiosSettings) {
		const entityType = settings.entityType || "host";
		try {
			const cleanUrl = settings.url!.trim().replace(/\/$/, "");
			let queryUrl = "";

			if (entityType === "host") {
				queryUrl = `${cleanUrl}/cgi-bin/statusjson.cgi?query=host&hostname=${encodeURIComponent(settings.hostName!)}`;
			} else if (entityType === "service") {
				if (!settings.serviceName) {
					if (this.visibleActions.has(action.id)) {
						this.drawConfigureState(action);
					}
					return;
				}
				queryUrl = `${cleanUrl}/cgi-bin/statusjson.cgi?query=service&hostname=${encodeURIComponent(settings.hostName!)}&servicedescription=${encodeURIComponent(settings.serviceName)}`;
			} else if (entityType === "host_totals") {
				if (settings.hostgroup) {
					const response = await fetch(`${cleanUrl}/cgi-bin/statusjson.cgi?query=hostcount&hostgroup=${encodeURIComponent(settings.hostgroup)}`, {
						headers: getHeaders(settings),
						signal: AbortSignal.timeout(10000)
					});
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`);
					}
					const resJson = await response.json() as any;
					const count = resJson.data.count || {};
					const up = count.up || 0;
					const down = count.down || 0;
					const unreachable = count.unreachable || 0;
					const pending = count.pending || 0;

					const all = up + down + unreachable + pending;
					const avail = all > 0 ? (up / all) * 100 : 100.0;
					this.updateHistory(action.id, avail, settings);
					if (this.visibleActions.has(action.id)) {
						await this.drawTotalsButton(action, settings.hostgroup.toUpperCase(), avail, up, all, settings);
					}
					return;
				}

				const response = await fetch(`${cleanUrl}/cgi-bin/tac.cgi`, {
					headers: getHeaders(settings),
					signal: AbortSignal.timeout(10000)
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}

				const html = await response.text();
				const upMatch = html.match(/class=['"]hostHeader['"][^>]*>(\d+)\s+Up<\/a>/i);
				const downMatch = html.match(/class=['"]hostHeader['"][^>]*>(\d+)\s+Down<\/a>/i);
				const unreachableMatch = html.match(/class=['"]hostHeader['"][^>]*>(\d+)\s+Unreachable<\/a>/i);
				const pendingMatch = html.match(/class=['"]hostHeader['"][^>]*>(\d+)\s+Pending<\/a>/i);

				const up = upMatch ? parseInt(upMatch[1], 10) : 0;
				const down = downMatch ? parseInt(downMatch[1], 10) : 0;
				const unreachable = unreachableMatch ? parseInt(unreachableMatch[1], 10) : 0;
				const pending = pendingMatch ? parseInt(pendingMatch[1], 10) : 0;

				const all = up + down + unreachable + pending;
				const avail = all > 0 ? (up / all) * 100 : 100.0;
				this.updateHistory(action.id, avail, settings);
				if (this.visibleActions.has(action.id)) {
					await this.drawTotalsButton(action, "HOST TOTALS", avail, up, all, settings);
				}
				return;
			} else if (entityType === "service_totals") {
				if (settings.servicegroup || settings.hostgroup) {
					const groupParam = settings.servicegroup ? `servicegroup=${encodeURIComponent(settings.servicegroup)}` : `hostgroup=${encodeURIComponent(settings.hostgroup!)}`;
					const response = await fetch(`${cleanUrl}/cgi-bin/statusjson.cgi?query=servicecount&${groupParam}`, {
						headers: getHeaders(settings),
						signal: AbortSignal.timeout(10000)
					});
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`);
					}
					const resJson = await response.json() as any;
					const count = resJson.data.count || {};
					const ok = count.ok || 0;
					const warn = count.warning || 0;
					const crit = count.critical || 0;
					const unkn = count.unknown || 0;
					const pend = count.pending || 0;

					const all = ok + warn + crit + unkn + pend;
					const avail = all > 0 ? (ok / all) * 100 : 100.0;
					const titleText = settings.servicegroup ? settings.servicegroup : settings.hostgroup!;
					this.updateHistory(action.id, avail, settings);
					if (this.visibleActions.has(action.id)) {
						await this.drawTotalsButton(action, titleText.toUpperCase(), avail, ok, all, settings);
					}
					return;
				}

				const response = await fetch(`${cleanUrl}/cgi-bin/tac.cgi`, {
					headers: getHeaders(settings),
					signal: AbortSignal.timeout(10000)
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}

				const html = await response.text();
				const criticalMatch = html.match(/class=['"]serviceHeader['"][^>]*>(\d+)\s+Critical<\/a>/i);
				const warningMatch = html.match(/class=['"]serviceHeader['"][^>]*>(\d+)\s+Warning<\/a>/i);
				const unknownMatch = html.match(/class=['"]serviceHeader['"][^>]*>(\d+)\s+Unknown<\/a>/i);
				const okMatch = html.match(/class=['"]serviceHeader['"][^>]*>(\d+)\s+Ok<\/a>/i);
				const servicePendingMatch = html.match(/class=['"]serviceHeader['"][^>]*>(\d+)\s+Pending<\/a>/i);

				const ok = okMatch ? parseInt(okMatch[1], 10) : 0;
				const warn = warningMatch ? parseInt(warningMatch[1], 10) : 0;
				const crit = criticalMatch ? parseInt(criticalMatch[1], 10) : 0;
				const unkn = unknownMatch ? parseInt(unknownMatch[1], 10) : 0;
				const pend = servicePendingMatch ? parseInt(servicePendingMatch[1], 10) : 0;

				const all = ok + warn + crit + unkn + pend;
				const avail = all > 0 ? (ok / all) * 100 : 100.0;
				this.updateHistory(action.id, avail, settings);
				if (this.visibleActions.has(action.id)) {
					await this.drawTotalsButton(action, "SERVICE TOTALS", avail, ok, all, settings);
				}
				return;
			}

			let queryTime: number;
			let status: number;
			let lastStateChange = 0;

			if (entityType === "host") {
				const response = await fetch(queryUrl, {
					headers: getHeaders(settings),
					signal: AbortSignal.timeout(10000)
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}

				const resJson: any = await response.json();
				if (resJson.result && resJson.result.type_code !== 0) {
					throw new Error(resJson.result.message || "Nagios error");
				}

				queryTime = resJson.result.query_time;
				const hostData = resJson.data.host;
				const rawStatus = hostData.status;
				const isStandard = rawStatus === 0 || rawStatus === 3;
				status = getNormalizedHostStatus(rawStatus, isStandard);
				const avail = status === 2 ? 100.0 : 0.0;
				this.updateHistory(action.id, avail, settings);
				lastStateChange = hostData.last_state_change || hostData.last_hard_state_change || 0;
				if (this.visibleActions.has(action.id)) {
					await this.drawButton(action, settings.hostName!, "HOST", status, lastStateChange, queryTime, settings);
				}
			} else if (entityType === "service") {
				try {
					const response = await fetch(queryUrl, {
						headers: getHeaders(settings),
						signal: AbortSignal.timeout(10000)
					});

					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`);
					}

					const resJson: any = await response.json();
					if (resJson.result && resJson.result.type_code !== 0) {
						throw new Error(resJson.result.message || "Nagios error");
					}

					queryTime = resJson.result.query_time;
					const serviceData = resJson.data.service;
					const rawStatus = serviceData.status;
					const isStandard = rawStatus === 0 || rawStatus === 3;
					status = getNormalizedServiceStatus(rawStatus, isStandard);
					lastStateChange = serviceData.last_state_change || serviceData.last_hard_state_change || 0;
				} catch (err: any) {
					streamDeck.logger.warn(`Direct service status query failed for "${settings.serviceName}" on "${settings.hostName}". Retrying via fallback servicelist query. Error:`, err);
					const fallback = await this.fetchServiceStatusFallback(cleanUrl, settings);
					queryTime = fallback.queryTime;
					const isStandard = fallback.status === 0 || fallback.status === 3;
					status = getNormalizedServiceStatus(fallback.status, isStandard);
					lastStateChange = fallback.lastStateChange;
				}

				let avail = 0.0;
				if (status === 2) avail = 100.0;
				else if (status === 4) avail = 50.0;
				else avail = 0.0;
				this.updateHistory(action.id, avail, settings);

				if (this.visibleActions.has(action.id)) {
					await this.drawButton(action, settings.serviceName!, "SERVICE", status, lastStateChange, queryTime, settings);
				}
			}
		} catch (err: any) {
			streamDeck.logger.error(`Nagios check failed:`, err);
			if (this.visibleActions.has(action.id)) {
				await this.drawErrorState(
					action,
					entityType === "host_totals"
						? "Host Totals"
						: entityType === "service_totals"
						? "Service Totals"
						: settings.hostName || "Nagios",
					err.message || "Error"
				);
			}
		}
	}

	/**
	 * Fallback query using servicelist filter for services that crash direct query=service with HTTP 500.
	 */
	private async fetchServiceStatusFallback(cleanUrl: string, settings: NagiosSettings): Promise<{ status: number; lastStateChange: number; queryTime: number }> {
		const url = `${cleanUrl}/cgi-bin/statusjson.cgi?query=servicelist&hostname=${encodeURIComponent(settings.hostName!)}`;
		const response = await fetch(url, {
			headers: getHeaders(settings),
			signal: AbortSignal.timeout(10000)
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const resJson: any = await response.json();
		if (resJson.result && resJson.result.type_code !== 0) {
			throw new Error(resJson.result.message || "Nagios error");
		}

		const queryTime = resJson.result.query_time || Math.floor(Date.now() / 1000);
		const servicelist = resJson.data.servicelist || {};
		const hostServices = servicelist[settings.hostName!] || servicelist;

		if (hostServices && typeof hostServices === "object") {
			const item = hostServices[settings.serviceName!];
			if (item !== undefined) {
				let rawStatus = 0;
				let lastStateChange = 0;

				if (item && typeof item === "object") {
					rawStatus = item.status !== undefined ? item.status : 0;
					lastStateChange = item.last_state_change || item.last_hard_state_change || 0;
				} else {
					rawStatus = typeof item === "number" ? item : Number(item) || 0;
				}

				return { status: rawStatus, lastStateChange, queryTime };
			}
		}

		throw new Error(`Service "${settings.serviceName}" not found on host "${settings.hostName}"`);
	}

	/**
	 * Sets the action image to a dynamic SVG with current totals and color based on thresholds.
	 */
	private async drawTotalsButton(action: any, title: string, avail: number, okCount: number, allCount: number, settings: NagiosSettings) {
		const warn = settings.warnThreshold !== undefined ? parseFloat(settings.warnThreshold as any) : 99.0;
		const crit = settings.critThreshold !== undefined ? parseFloat(settings.critThreshold as any) : 98.0;

		let startColor = "#0A5C2C";
		let endColor = "#1DA853"; // Green (OK)

		if (avail < crit) {
			startColor = "#7C1010";
			endColor = "#E53E3E"; // Red (Critical)
		} else if (avail < warn) {
			startColor = "#9F5A00";
			endColor = "#D69E2E"; // Yellow (Warning)
		}

		const availStr = avail.toFixed(1) + "%";
		const countLabel = title.startsWith("HOST") ? `UP: ${okCount}/${allCount}` : `OK: ${okCount}/${allCount}`;
		
		let part1 = "";
		let part2 = "";
		if (title.includes(" ")) {
			const parts = title.split(" ");
			part1 = parts[0];
			part2 = parts.slice(1).join(" ");
		} else if (title.includes("-")) {
			const parts = title.split("-");
			part1 = parts[0];
			part2 = parts.slice(1).join("-");
		} else if (title.includes("_")) {
			const parts = title.split("_");
			part1 = parts[0];
			part2 = parts.slice(1).join("_");
		} else {
			part1 = title;
		}

		const trunc1 = part1.length > 14 ? part1.substring(0, 11) + "..." : part1;
		const trunc2 = part2.length > 14 ? part2.substring(0, 11) + "..." : part2;

		const textSvg = `
  <text x="72" y="22" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.9">${escapeXml(trunc1)}</text>
  <text x="72" y="36" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.9">${escapeXml(trunc2)}</text>
		`.trim();

		let graphSvg = "";
		if (settings.showGraph) {
			const durationMin = settings.graphDuration !== undefined ? parseFloat(settings.graphDuration as any) : 60;
			const durationMs = durationMin * 60 * 1000;
			const actionHistory = this.history.get(action.id) || [];
			graphSvg = this.getGraphSvgPath(actionHistory, durationMs, Date.now());
		}

		const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${startColor}" />
      <stop offset="100%" stop-color="${endColor}" />
    </linearGradient>
  </defs>
  <rect width="144" height="144" rx="20" fill="url(#bgGrad)" />
  ${graphSvg}
  <rect width="144" height="72" rx="20" fill="white" fill-opacity="0.08" />
  
  ${textSvg}
  <text x="72" y="76" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="20" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${availStr}</text>
  
  <rect x="14" y="96" width="116" height="24" rx="12" fill="black" fill-opacity="0.25" />
  <text x="72" y="113" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.95">${countLabel}</text>
</svg>
`.trim();

		const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
		await action.setImage(svgDataUri);
	}

	/**
	 * Sets the action image to a dynamic SVG with current state and color.
	 */
	private async drawButton(action: any, displayName: string, entityTypeLabel: string, status: number, lastStateChange: number, queryTime: number, settings: NagiosSettings) {
		let statusLabel = "UNKNOWN";
		let startColor = "#4A5568";
		let endColor = "#718096";

		if (entityTypeLabel === "HOST") {
			// Nagios Core statusjson.cgi host status bitmasks:
			// 1 = PENDING, 2 = UP, 4 = DOWN, 8 = UNREACHABLE
			if (status === 2) {
				statusLabel = "UP";
				startColor = "#0A5C2C";
				endColor = "#1DA853";
			} else if (status === 4) {
				statusLabel = "DOWN";
				startColor = "#7C1010";
				endColor = "#E53E3E";
			} else if (status === 8) {
				statusLabel = "UNREACH";
				startColor = "#4A5568";
				endColor = "#718096";
			} else if (status === 1) {
				statusLabel = "PENDING";
				startColor = "#4A5568";
				endColor = "#718096";
			}
		} else {
			// Nagios Core statusjson.cgi service status bitmasks:
			// 1 = PENDING, 2 = OK, 4 = WARNING, 8 = UNKNOWN, 16 = CRITICAL
			if (status === 2) {
				statusLabel = "OK";
				startColor = "#0A5C2C";
				endColor = "#1DA853";
			} else if (status === 4) {
				statusLabel = "WARN";
				startColor = "#9F5A00";
				endColor = "#D69E2E";
			} else if (status === 16) {
				statusLabel = "CRIT";
				startColor = "#7C1010";
				endColor = "#E53E3E";
			} else if (status === 8) {
				statusLabel = "UNKN";
				startColor = "#4A5568";
				endColor = "#718096";
			} else if (status === 1) {
				statusLabel = "PEND";
				startColor = "#4A5568";
				endColor = "#718096";
			}
		}

		const duration = formatDuration(lastStateChange, queryTime);

		let textSvg = "";
		const parts = displayName.split(" - ");
		if (parts.length > 1) {
			const part1 = parts[0];
			const part2 = parts.slice(1).join(" - ");
			const trunc1 = part1.length > 15 ? part1.substring(0, 12) + "..." : part1;
			const trunc2 = part2.length > 15 ? part2.substring(0, 12) + "..." : part2;
			textSvg = `
  <text x="72" y="21" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="10" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.9">${escapeXml(trunc1)}</text>
  <text x="72" y="33" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="10" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.9">${escapeXml(trunc2)}</text>
			`.trim();
		} else {
			const truncatedName = displayName.length > 15 ? displayName.substring(0, 12) + "..." : displayName;
			textSvg = `
  <text x="72" y="32" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.9">${escapeXml(truncatedName)}</text>
			`.trim();
		}

		let graphSvg = "";
		if (settings.showGraph) {
			const durationMin = settings.graphDuration !== undefined ? parseFloat(settings.graphDuration as any) : 60;
			const durationMs = durationMin * 60 * 1000;
			const actionHistory = this.history.get(action.id) || [];
			graphSvg = this.getGraphSvgPath(actionHistory, durationMs, Date.now());
		}

		const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${startColor}" />
      <stop offset="100%" stop-color="${endColor}" />
    </linearGradient>
  </defs>
  <rect width="144" height="144" rx="20" fill="url(#bgGrad)" />
  ${graphSvg}
  <rect width="144" height="72" rx="20" fill="white" fill-opacity="0.08" />
  
  ${textSvg}
  <text x="72" y="76" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="20" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">${statusLabel}</text>
  
  <rect x="22" y="98" width="100" height="20" rx="10" fill="black" fill-opacity="0.25" />
  <text x="72" y="112" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.95">${duration}</text>
</svg>
`.trim();

		const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
		await action.setImage(svgDataUri);
	}

	/**
	 * Draws a neutral state suggesting setup is required.
	 */
	private async drawConfigureState(action: any) {
		const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2d3748" />
      <stop offset="100%" stop-color="#4a5568" />
    </linearGradient>
  </defs>
  <rect width="144" height="144" rx="20" fill="url(#bgGrad)" />
  <text x="72" y="55" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.8">NAGIOS</text>
  <rect x="22" y="75" width="100" height="24" rx="12" fill="black" fill-opacity="0.2" />
  <text x="72" y="91" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.95">Setup UI</text>
</svg>
`.trim();
		const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
		await action.setImage(svgDataUri);
	}

	/**
	 * Draws a clear error status on the button.
	 */
	private async drawErrorState(action: any, name: string, errMsg: string) {
		const truncatedName = name.length > 15 ? name.substring(0, 12) + "..." : name;
		const shortErr = errMsg.length > 18 ? errMsg.substring(0, 15) + "..." : errMsg;

		const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7C1010" />
      <stop offset="100%" stop-color="#C53030" />
    </linearGradient>
  </defs>
  <rect width="144" height="144" rx="20" fill="url(#bgGrad)" />
  <text x="72" y="32" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.9">${escapeXml(truncatedName)}</text>
  <text x="72" y="70" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="20" font-weight="900" fill="#ffffff" text-anchor="middle">OFFLINE</text>
  <text x="72" y="100" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="10" font-weight="bold" fill="#ffccd5" text-anchor="middle" opacity="0.9">${escapeXml(shortErr)}</text>
</svg>
`.trim();
		const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
		await action.setImage(svgDataUri);
	}

	private getEntityKey(settings: NagiosSettings): string {
		return `${settings.entityType || "host"}:${settings.hostName || ""}:${settings.serviceName || ""}:${settings.hostgroup || ""}:${settings.servicegroup || ""}`;
	}

	private updateHistory(actionId: string, avail: number, settings: NagiosSettings) {
		if (settings.showGraph) {
			const durationMin = settings.graphDuration !== undefined ? parseFloat(settings.graphDuration as any) : 60;
			const durationMs = durationMin * 60 * 1000;
			const now = Date.now();

			let actionHistory = this.history.get(actionId) || [];
			actionHistory.push({ time: now, value: avail });

			// Filter out old points
			actionHistory = actionHistory.filter(pt => pt.time >= now - durationMs);
			this.history.set(actionId, actionHistory);
		} else {
			this.history.delete(actionId);
		}
	}

	private getGraphSvgPath(history: Array<{ time: number; value: number }>, durationMs: number, now: number): string {
		if (history.length === 0) return "";

		const Y_MIN = 40;
		const Y_MAX = 144;
		const X_MAX = 144;
		const startTime = now - durationMs;

		const points: Array<{ x: number; y: number }> = [];

		for (const pt of history) {
			if (pt.time < startTime) continue;
			const pct = (pt.time - startTime) / durationMs;
			const x = Math.min(X_MAX, Math.max(0, pct * X_MAX));
			const y = Y_MAX - (pt.value / 100) * (Y_MAX - Y_MIN);
			points.push({ x, y });
		}

		if (points.length === 0) {
			// If all points are before startTime, use the last one
			const lastPt = history[history.length - 1];
			const y = Y_MAX - (lastPt.value / 100) * (Y_MAX - Y_MIN);
			points.push({ x: 0, y });
			points.push({ x: X_MAX, y });
		} else {
			// Ensure we start at x = 0
			if (points[0].x > 0) {
				points.unshift({ x: 0, y: points[0].y });
			}
			// Ensure we end at x = X_MAX
			if (points[points.length - 1].x < X_MAX) {
				points.push({ x: X_MAX, y: points[points.length - 1].y });
			}
		}

		// Build SVG path data for area fill
		let pathD = `M 0,${Y_MAX}`;
		for (const pt of points) {
			pathD += ` L ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
		}
		pathD += ` L ${X_MAX},${Y_MAX} Z`;

		// Build SVG path data for stroke line
		let lineD = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
		for (let i = 1; i < points.length; i++) {
			lineD += ` L ${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
		}

		return `
  <path d="${pathD}" fill="white" fill-opacity="0.12" />
  <path d="${lineD}" fill="none" stroke="white" stroke-opacity="0.35" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
		`.trim();
	}

	override onWillAppear(ev: WillAppearEvent<NagiosSettings>): void | Promise<void> {
		this.visibleActions.add(ev.action.id);

		// Clear any pending cleanup timer for this action
		const cleanupTimer = this.cleanupTimers.get(ev.action.id);
		if (cleanupTimer) {
			clearTimeout(cleanupTimer);
			this.cleanupTimers.delete(ev.action.id);
		}

		return this.startPolling(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<NagiosSettings>): void | Promise<void> {
		this.visibleActions.delete(ev.action.id);

		// If showGraph is enabled, schedule a cleanup after 5 minutes of inactivity (switched page/deleted)
		if (ev.payload.settings.showGraph) {
			// Clear any existing cleanup timer first
			const existingTimer = this.cleanupTimers.get(ev.action.id);
			if (existingTimer) {
				clearTimeout(existingTimer);
			}

			const cleanupTimer = setTimeout(() => {
				this.stopPolling(ev.action.id);
				this.history.delete(ev.action.id);
				this.lastEntityKey.delete(ev.action.id);
				this.cleanupTimers.delete(ev.action.id);
				streamDeck.logger.info(`Stopped background polling and cleaned up history for inactive action: ${ev.action.id}`);
			}, 5 * 60 * 1000); // 5 minutes

			this.cleanupTimers.set(ev.action.id, cleanupTimer);
		} else {
			this.stopPolling(ev.action.id);
			this.history.delete(ev.action.id);
			this.lastEntityKey.delete(ev.action.id);
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<NagiosSettings>): void | Promise<void> {
		this.visibleActions.add(ev.action.id);

		// Clear any pending cleanup timer for this action
		const cleanupTimer = this.cleanupTimers.get(ev.action.id);
		if (cleanupTimer) {
			clearTimeout(cleanupTimer);
			this.cleanupTimers.delete(ev.action.id);
		}

		return this.startPolling(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<NagiosSettings>): Promise<void> {
		const { settings } = ev.payload;
		const entityType = settings.entityType || "host";
		const isTotals = entityType === "host_totals" || entityType === "service_totals";
		if (!settings.url || (!isTotals && !settings.hostName)) return;

		const cleanUrl = settings.url.trim().replace(/\/$/, "");
		let targetUrl = "";

		if (entityType === "host") {
			targetUrl = `${cleanUrl}/cgi-bin/extinfo.cgi?type=1&host=${encodeURIComponent(settings.hostName!)}`;
		} else if (entityType === "service") {
			if (!settings.serviceName) return;
			targetUrl = `${cleanUrl}/cgi-bin/extinfo.cgi?type=2&host=${encodeURIComponent(settings.hostName!)}&service=${encodeURIComponent(settings.serviceName!)}`;
		} else if (entityType === "host_totals") {
			if (settings.hostgroup) {
				targetUrl = `${cleanUrl}/cgi-bin/status.cgi?hostgroup=${encodeURIComponent(settings.hostgroup)}&style=hostdetail`;
			} else {
				targetUrl = `${cleanUrl}/cgi-bin/status.cgi?host=all&style=hostdetail`;
			}
		} else if (entityType === "service_totals") {
			if (settings.servicegroup) {
				targetUrl = `${cleanUrl}/cgi-bin/status.cgi?servicegroup=${encodeURIComponent(settings.servicegroup)}`;
			} else if (settings.hostgroup) {
				targetUrl = `${cleanUrl}/cgi-bin/status.cgi?hostgroup=${encodeURIComponent(settings.hostgroup)}`;
			} else {
				targetUrl = `${cleanUrl}/cgi-bin/status.cgi?host=all`;
			}
		}

		try {
			await streamDeck.system.openUrl(targetUrl);
		} catch (err) {
			streamDeck.logger.error(`Failed to open Nagios details page:`, err);
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<any, NagiosSettings>): Promise<void> {
		const payload = ev.payload;
		if (!payload) return;

		if (payload.event === "connect") {
			const { url, username, password } = payload;
			try {
				const cleanUrl = url.trim().replace(/\/$/, "");
				const headers = {
					"Authorization": `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
					"Accept": "application/json"
				};

				const [hostsRes, servicesRes] = await Promise.all([
					fetch(`${cleanUrl}/cgi-bin/statusjson.cgi?query=hostlist`, { headers, signal: AbortSignal.timeout(10000) }),
					fetch(`${cleanUrl}/cgi-bin/statusjson.cgi?query=servicelist`, { headers, signal: AbortSignal.timeout(10000) })
				]);

				if (!hostsRes.ok || !servicesRes.ok) {
					throw new Error(`Failed HTTP status: ${hostsRes.status}/${servicesRes.status}`);
				}

				const hostsJson: any = await hostsRes.json();
				const servicesJson: any = await servicesRes.json();

				if ((hostsJson.result && hostsJson.result.type_code !== 0) || (servicesJson.result && servicesJson.result.type_code !== 0)) {
					throw new Error(hostsJson.result?.message || servicesJson.result?.message || "Nagios CGI error");
				}

				const hostNames = Object.keys(hostsJson.data.hostlist || {});
				const hostServiceMap = buildHostServiceMap(getServicesFromList(servicesJson.data.servicelist || {}));

				let hostgroups: string[] = [];
				let servicegroups: string[] = [];
				try {
					const hgRes = await fetch(`${cleanUrl}/cgi-bin/objectjson.cgi?query=hostgrouplist`, { headers, signal: AbortSignal.timeout(10000) });
					if (hgRes.ok) {
						const hgJson = await hgRes.json() as any;
						hostgroups = hgJson.data.hostgrouplist || [];
					}
				} catch (err) {
					streamDeck.logger.warn("Failed to fetch hostgroups in connect:", err);
				}

				try {
					const sgRes = await fetch(`${cleanUrl}/cgi-bin/objectjson.cgi?query=servicegrouplist`, { headers, signal: AbortSignal.timeout(10000) });
					if (sgRes.ok) {
						const sgJson = await sgRes.json() as any;
						servicegroups = sgJson.data.servicegrouplist || [];
					}
				} catch (err) {
					streamDeck.logger.warn("Failed to fetch servicegroups in connect:", err);
				}

				// Populate configuration cache
				this.configCache = {
					timestamp: Date.now(),
					url: cleanUrl,
					hostNames,
					hostServiceMap,
					hostgroups,
					servicegroups
				};

				// Persist global settings
				await streamDeck.settings.setGlobalSettings({ url, username, password });

				// Reply back to UI
				await streamDeck.ui.sendToPropertyInspector({
					event: "connected",
					hostNames,
					hostServiceMap,
					hostgroups,
					servicegroups
				});
			} catch (err: any) {
				streamDeck.logger.error("Connection attempt error:", err);
				await streamDeck.ui.sendToPropertyInspector({
					event: "connection_failed",
					error: err.message || "Failed to reach Nagios Core."
				});
			}
		}

		else if (payload.event === "fetch_hosts_services") {
			const actionSettings = await ev.action.getSettings();
			let url = actionSettings.url;
			let username = actionSettings.username;
			let password = actionSettings.password;

			if (!url || !username || !password) {
				const globalSettings = await streamDeck.settings.getGlobalSettings<any>();
				url = globalSettings.url;
				username = globalSettings.username;
				password = globalSettings.password;
			}

			if (!url || !username || !password) {
				await streamDeck.ui.sendToPropertyInspector({ event: "not_logged_in" });
				return;
			}

			try {
				const cleanUrl = url.trim().replace(/\/$/, "");

				// Check configuration cache (valid for 5 minutes)
				if (this.configCache &&
					this.configCache.url === cleanUrl &&
					(Date.now() - this.configCache.timestamp < 5 * 60 * 1000)) {
					streamDeck.logger.info("Serving host and service list from configuration cache");
					await streamDeck.ui.sendToPropertyInspector({
						event: "hosts_services_list",
						hostNames: this.configCache.hostNames,
						hostServiceMap: this.configCache.hostServiceMap,
						hostgroups: this.configCache.hostgroups,
						servicegroups: this.configCache.servicegroups,
						credentials: { url, username, password },
						actionSettings
					});
					return;
				}

				const headers = {
					"Authorization": `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
					"Accept": "application/json"
				};

				const [hostsRes, servicesRes] = await Promise.all([
					fetch(`${cleanUrl}/cgi-bin/statusjson.cgi?query=hostlist`, { headers, signal: AbortSignal.timeout(10000) }),
					fetch(`${cleanUrl}/cgi-bin/statusjson.cgi?query=servicelist`, { headers, signal: AbortSignal.timeout(10000) })
				]);

				if (!hostsRes.ok || !servicesRes.ok) {
					throw new Error(`HTTP Status: ${hostsRes.status}/${servicesRes.status}`);
				}

				const hostsJson: any = await hostsRes.json();
				const servicesJson: any = await servicesRes.json();

				const hostNames = Object.keys(hostsJson.data.hostlist || {});
				const hostServiceMap = buildHostServiceMap(getServicesFromList(servicesJson.data.servicelist || {}));

				let hostgroups: string[] = [];
				let servicegroups: string[] = [];
				try {
					const hgRes = await fetch(`${cleanUrl}/cgi-bin/objectjson.cgi?query=hostgrouplist`, { headers, signal: AbortSignal.timeout(10000) });
					if (hgRes.ok) {
						const hgJson = await hgRes.json() as any;
						hostgroups = hgJson.data.hostgrouplist || [];
					}
				} catch (err) {
					streamDeck.logger.warn("Failed to fetch hostgroups:", err);
				}

				try {
					const sgRes = await fetch(`${cleanUrl}/cgi-bin/objectjson.cgi?query=servicegrouplist`, { headers, signal: AbortSignal.timeout(10000) });
					if (sgRes.ok) {
						const sgJson = await sgRes.json() as any;
						servicegroups = sgJson.data.servicegrouplist || [];
					}
				} catch (err) {
					streamDeck.logger.warn("Failed to fetch servicegroups:", err);
				}

				// Populate configuration cache
				this.configCache = {
					timestamp: Date.now(),
					url: cleanUrl,
					hostNames,
					hostServiceMap,
					hostgroups,
					servicegroups
				};

				await streamDeck.ui.sendToPropertyInspector({
					event: "hosts_services_list",
					hostNames,
					hostServiceMap,
					hostgroups,
					servicegroups,
					credentials: { url, username, password },
					actionSettings
				});
			} catch (err: any) {
				streamDeck.logger.error("Error fetching host and service configurations:", err);
				await streamDeck.ui.sendToPropertyInspector({
					event: "fetch_failed",
					error: err.message || "Failed to query hosts/services."
				});
			}
		}
	}
}

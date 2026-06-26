---
name: streamdeck-property-inspector
description: Best practices for managing state, credentials, and settings synchronization in Elgato Stream Deck Property Inspectors.
---

# Stream Deck Property Inspector State Management Skill

This skill outlines guidelines and solutions for developing Property Inspectors (UI configuration panels) for Elgato Stream Deck plugins.

## State Initialization & Timing Races
- **Problem**: Calling `streamDeckClient.getSettings()` during PI initialization can return `{}` before the Stream Deck WebSocket has delivered the persisted settings event (`didReceiveSettings`).
- **Solution**: Have the plugin backend echo the full action settings inside custom send-to-PI events (e.g. `hosts_services_list`). When the PI receives this event, it merges the echoed settings into its local `activeSettings` object.

## Credentials Preservation
- **Problem**: When using form controls to configure settings in the Property Inspector, saving fields (like Entity Type, Hostgroup) can overwrite local action settings, clearing credentials (`url`, `username`, `password`) if they are not explicitly merged into the save payload.
- **Solution**:
  - Always merge credentials received from the plugin (or loaded globally) into the PI's local `activeSettings` object before updating settings.
  - The backend plugin's polling logic should dynamically load global credentials (using `streamDeck.settings.getGlobalSettings()`) if they are missing from the local action settings.

## Dynamic Field Updates
- **Problem**: Switching the monitor type dynamically (e.g. to `"service"`) displays conditional fields but leaves them unpopulated if they rely on other inputs.
- **Solution**: Always trigger dropdown population functions (e.g. `populateServices()`) when dependent fields or entity types change in the Property Inspector.

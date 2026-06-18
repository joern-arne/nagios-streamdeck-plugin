import streamDeck from "@elgato/streamdeck";

import { NagiosStatus } from "./actions/nagios-status";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register the nagios status action.
streamDeck.actions.registerAction(new NagiosStatus());

// Finally, connect to the Stream Deck.
streamDeck.connect();

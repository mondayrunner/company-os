# Extending company-os

Four extension points, one rule each. You add a file; nothing else changes.

| You want | You add | It shows up in |
| --- | --- | --- |
| A new source (Moneybird, Mollie, Notion) | `connectors/<name>.mjs` | `live`, `snapshot`, the MCP tools, and every panel of that kind |
| A new tile on the overview | `app/components/panels/<Name>.global.vue` | the overview, in the order of `ui.panels` |
| A new health check | `checks/<name>.mjs` | `company-os check` and the inbox |
| A new scheduled task | one entry in `jobs` | `company-os jobs list` and the status page |

Public versions live in this repo. Your own live in your vault and win when the names clash, so you never fork.

| | Public | Yours |
| --- | --- | --- |
| Connectors | `connectors/` | `<vault>/connectors/` |
| Checks | `checks/` | `<vault>/checks/` |
| Panels and pages | `ui/app/` | your dashboard layer |

## Add a connector

A connector answers one question: where does this kind of thing live? Trello and a markdown file both hold tasks, so both are `kind: "tasks"`. Everything downstream asks for the kind, never the vendor. That is why swapping Stripe for Moneybird is a config edit.

1. Write the file. Name it after the service.

```js
// <vault>/connectors/moneybird.mjs
import { secret, fetchRetry } from "../../company-os/core/env.mjs";

export default {
  name: "moneybird",
  kind: "finance",      // finance | tasks | calendar | mail | crm | metrics | files
  volatile: true,       // read live, never copied into markdown
  location: "moneybird.nl",

  // Read live. The dashboard, the MCP tools and the checks all come through here.
  async live(query, ctx, options) {
    const key = await secret(options, "MONEYBIRD_TOKEN");
    if (query.what === "subscriptions") { /* … */ return { items, fetched: new Date().toISOString() } }
    throw new Error(`moneybird: unknown query "${query.what}"`);
  },

  // Once a day, for the history. Numbers only.
  async scan(ctx, options) {
    const date = new Date().toISOString().slice(0, 10);
    return { metrics: [{ date, key: "mrr", value: 1234 }], count: 1, message: "…" };
  },
};
```

2. Point the config at it and name the env file that holds the key.

```json
"connectors": { "moneybird": { "envFile": "~/.config/moneybird/.env", "keyName": "MONEYBIRD_TOKEN" } }
```

3. Check it. `company-os live finance subscriptions` reads it. `company-os snapshot` stores today's numbers. `company-os check` runs the finance checks against it.

Rules that are not optional:

- **No `write()`.** A connector reads. Anything that changes the outside world becomes an inbox item a human approves.
- **`volatile: true` for anything live.** The value then stays in the source and is fetched when asked. Copy it into markdown and you have a second system that is wrong by tomorrow.
- **Secrets from an env file.** The connector names the file, the vault never holds a key.
- **Same `what` values as the connector you replace.** That is what makes them interchangeable. See `connectors/stripe.mjs` for the finance shape and `connectors/trello.mjs` for tasks.

## Add a panel

A panel is a component. The overview renders the list in `ui.panels`, looks each name up, and shows what it finds.

1. Write `app/components/panels/Invoices.global.vue`. The `.global` part matters: the page looks the component up by name, and Nuxt only bundles a component it can see written out in a template.

```vue
<script setup lang="ts">
const { fmt } = useConfig()
</script>

<template>
  <!-- `api` is the route. `span` makes it wider. -->
  <Panel title="Invoices" api="invoices" span="xl:col-span-2" v-slot="{ data }">
    <p v-for="i in data.items" :key="i.id" class="text-[13px]">{{ i.customer }} · {{ fmt.money(i.amount) }}</p>
  </Panel>
</template>
```

2. Add the name to the config, in the order you want to read them.

```json
"ui": { "panels": ["invoices", "tasks", "calendar", "brain", "inbox"] }
```

`Panel` fetches `/api/<api>` itself, shows a skeleton while it waits and an error when the source is down. You write the middle. Leave `ui.panels` out and the list follows your live connector kinds, plus the brain and the inbox.

A name in `ui.panels` with no component gets a card that says which file to add. A kind with no panel stays quiet: that is a gap, not a mistake.

To replace a panel this repo ships, put a file with the same name in your own layer. Yours wins.

## Brand it

Three keys, no code:

```json
{ "name": "Acme", "ui": { "title": "Acme OS", "logo": "/brand/logo.svg" } }
```

`name` is the company (also the logo's alt text), `ui.title` is what the header
and the browser tab say, `ui.logo` is a path under `ui/public/` or any URL.
Leave the logo out and you get a small mark. Nothing else in the interface
carries a brand, so there is no second place to change.

## Add a page

Write `app/pages/invoices.vue` in your layer, then add it to the nav:

```json
"ui": { "nav": [{ "p": "/invoices", "t": "Invoices" }] }
```

Use `useConfig()` for dates and money so the page follows the language in your config, and `Panel`, `Count` and `Wave` so it looks like the rest.

## Add a check

A check reads the vault and returns findings. No AI: these are the controls you want free and debuggable.

```js
// <vault>/checks/invoices-vs-accounts.mjs
export default {
  name: "invoices-vs-accounts",
  description: "open invoices ↔ account folders",
  needs: ["finance"],                 // skipped when no live finance connector exists
  async run(ctx, h, options) {
    const r = await h.live("finance", { what: "open-invoices" });
    return r.items
      .filter((i) => !h.matchFolder(i.customer, Object.values(await h.accountFolders()).flat()))
      .map((i) => ({ severity: "warn", where: `invoice ${i.number}`, what: `${i.customer} has no account folder` }));
  },
};
```

`h` gives you `read`, `list`, `exists`, `live`, `accountFolders`, `pipelineLeads`, `matchFolder` and the database. `options` is your own `config.checks.<name>` block.

Every finding becomes one inbox item, fingerprinted, so the same finding never lands twice. Stop reporting it and the item closes itself.

## Add a job

```json
"jobs": [{ "name": "invoices", "title": "Chase open invoices", "run": "company-os check --only invoices-vs-accounts", "cron": "0 9 * * 1" }]
```

`company-os jobs install` writes launchd plists, a crontab block or systemd timers, whichever the machine takes. Every job writes the same status file, rotates its own log and adds a row to the event history. `company-os jobs run <name>` runs one by hand.

## What not to build

- **A connector that writes.** Propose it in the inbox instead.
- **Two-way sync between markdown and a system.** Markdown is the canon for what you decide. The system is the canon for what it measures. Neither copies the other.
- **A panel that fetches from a service directly.** Panels call `/api/...`. Server routes hold the keys, so no key reaches the browser.

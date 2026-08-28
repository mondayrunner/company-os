# company-os ui

The dashboard: what your brain knows, what your live sources say right now, and what is waiting for you in the inbox. Nuxt 4 + Tailwind, no other dependencies. Every source call happens in a server route, so no key ever reaches the browser.

```bash
cd ui && npm install
COMPANY_OS_ROOT=/path/to/your/vault npm run dev     # http://localhost:4321
```

Or as a job: add `{ "name": "ui", "title": "Dashboard", "run": "cd ui && npx nuxt dev --port 4321", "service": true }` to `jobs` and run `company-os jobs install`.

## It mirrors your config

There is no fixed set of panels. The overview shows one panel per live connector *kind* in your `company-os.config.json`: a `finance` connector gives a finance panel, no `mail` connector means no mail panel. `/status` lists every connector and job with its state — that page *is* the module overview. Turning something off is one line in the config.

Pages: `/` overview, `/ask` ask the brain, `/inbox` answer and approve, `/status` modules and jobs.

## Making it yours

`ui.title`, `ui.logo`, `ui.nav` and `ui.examples` in the config cover the small stuff. For real changes, use it as a Nuxt layer:

```ts
// my-dashboard/nuxt.config.ts
export default defineNuxtConfig({ extends: ["../company-os-engine/ui"] })
```

Then add your own pages under `app/pages/`, override a component by giving yours the same name, and put your fonts and colours in your own `main.css`. Your private routes (an accounting API, a mail draft flow) live in your layer, not in this repo.

The interface language is English; `language` in the config sets the language your agents *answer* in.

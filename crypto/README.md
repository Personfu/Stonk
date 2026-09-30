# Optional crypto SDK sandbox

The Pump SDKs and Solana helpers requested for agent experiments are isolated here. Run `npm ci` in this directory to install them. The main stock terminal does not import this module, expose a wallet, pay x402 requests, or send crypto trades.

`@agenti/sdk` is [not published to npm yet](https://github.com/nirholas/agenti#packages); the install command returns 404. The agenti repository can be evaluated separately after a release. It provides crypto payment and wallet tools, not a U.S. stock brokerage connection.

The current Pump dependency tree has npm security advisories. Run `npm audit` and review fixes before adding any signing or payment path. Never put a private key in a browser bundle, source file, chat, or repository. A future service needs scoped secrets, explicit spending limits, transaction simulation, and an audit trail.

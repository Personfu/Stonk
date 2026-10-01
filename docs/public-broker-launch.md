# Public customer brokerage launch

STONK's current customer sign-in is a research account. The private trading desk uses one operator account. Neither is a customer brokerage account, and the operator credentials must never be used for public orders or deposits.

The proposed customer route is the U.S. Alpaca **Broker API**. Its correspondent keys are separate from the existing `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY`. `api/_lib/broker-api.js` is an isolated, sandbox-default transport for account status, Plaid-linked ACH relationships, deposits, and account-scoped equity limit orders. It is not imported by a public API route or the browser. Its existence does not enable customer money movement.

## Account owner and provider work

1. Complete Alpaca Broker Dashboard's launch guide with the company's **actual** business classification. Do not claim to be a broker-dealer unless the company is registered as one. Alpaca's onboarding and account approval responsibilities differ by arrangement.
2. Finish the Alpaca business integration and obtain production correspondent access, an agreement covering funding, and the approved customer account-opening and disclosures process. Sandbox keys and simulated deposits do not establish production access.
3. Activate the Alpaca integration in a Plaid account and obtain production Plaid access for ACH linking. Bank credentials and raw routing/account numbers must not pass through STONK. The Plaid processor token goes server-to-server to Alpaca.
4. License any market data redistributed in the public product. A personal Alpaca market-data plan is not a public redistribution license.
5. Enable Supabase custom SMTP for public sign-up email with a verified sender; configure and test the confirmation and password-reset flows on `https://st0nk.org/account.html`.

## Application work before public launch

- Submit the broker-approved KYC application and agreements for each signed-in customer without storing tax IDs or identity documents in the research database. Show the broker's `SUBMITTED`, `ACTION_REQUIRED`, `APPROVAL_PENDING`, `APPROVED`, and `ACTIVE` states accurately.
- Bind exactly one approved broker account ID to the authenticated customer in a server-controlled table. Never accept an account ID supplied by the browser for funding, balances, positions, or orders. Confirm ownership and active status on every money-moving request.
- Exchange Plaid Link's public token for a processor token on the server, create the broker ACH relationship, verify its status, then preview and explicitly confirm each deposit. Reconcile asynchronous transfer status before displaying spendable funds.
- Gate stock orders on active account, broker trading permissions, verified buying power, asset eligibility, order preview, explicit customer confirmation, per-order risk limits, stable idempotency key, and broker order-state reconciliation. Keep automatic trading off until the partner has approved that use case and it has separate, tested controls.
- Test customer isolation, KYC action-required states, ACH failure/returns, insufficient funds, duplicate/retried orders, partial fills, market closure, and account suspension in sandbox. Complete a controlled production pilot with Alpaca before broad public access.
- Only after those gates pass, put production Broker API and Plaid secrets in server-only environment variables and enable the explicit live flags. Never place them in the repository, browser, or a chat message.

## Configuration for the isolated Broker API transport

`ALPACA_BROKER_ENV` defaults to `sandbox`; use a Broker Dashboard **Client Secret** credential in `ALPACA_BROKER_CLIENT_ID` and `ALPACA_BROKER_CLIENT_SECRET`. The server exchanges it for a short-lived OAuth access token and sends that token to Broker API. A legacy Basic-authentication key is not interchangeable with a Client Secret credential. Live transport also requires `STONK_BROKER_PARTNER_APPROVED=true` and `STONK_PUBLIC_BROKER_LIVE=I_UNDERSTAND_CUSTOMER_FUNDS`. These flags are an operator acknowledgement, **not** proof of Alpaca approval.

`database/customer_broker_accounts.sql` defines a server-only binding between a confirmed customer sign-in and the broker account created after approval. The read-only `/api/customer-broker` status route verifies the customer's Supabase access token, looks up that mapping using a server-only `SUPABASE_SERVICE_ROLE_KEY`, checks that sandbox/live environment matches, and reports broker account state. It cannot open accounts, link banks, transfer funds, or place orders. Do not populate a mapping until ownership and identity approval have been verified; do not enter the service role key in browser code or chat. Money-moving public routes remain absent until the application and provider work above is done.

Provider references: [Broker API setup](https://docs.alpaca.markets/us/docs/getting-started-with-broker-api), [current authentication](https://docs.alpaca.markets/us/docs/authentication), [account opening](https://docs.alpaca.markets/us/docs/account-opening), [production integration](https://docs.alpaca.markets/us/docs/integration-setup-with-alpaca), [ACH funding](https://docs.alpaca.markets/us/docs/ach-funding), [customer orders](https://docs.alpaca.markets/us/reference/createorderforaccount).


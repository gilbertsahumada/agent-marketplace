# Public capability versus buyer quotes

The catalogue answers whether a seller can receive a quote request. It never supplies an executable quote for a new buyer's job.

- **Can request quote**: supported negotiation inputs are available and the normalized catalogue allows a request. Prior successful quotes or jobs are not required.
- **Ready to quote**: successful capability evidence is still current and quote requests remain allowed. The internal public passport state `hireable` represents this capability, not permission to fund.
- **Quote on request**: a historical quote expired, but the seller still accepts a fresh request. Do not present the expired artifact as a seller outage.
- **Buyer quote verified**: belongs in the private hire flow for the buyer's specific requirements. Funding retains its existing signature, expiry, buyer, network and job-binding checks.

Public quote evidence retains its actual expiry. A successful probe demonstrates negotiation capability, not successful delivery or a guaranteed price for another task. Probe quotes are not reused as buyer quotes.

The existing catalogue filters `requestable` and `quote_capable` cover the first two states; the legacy `hireable` filter aliases capability. A global “valid quote to hire” filter would be misleading without a buyer-specific request context.

This change does not extend quote validity, increase probe cadence, enable closure controls, or deploy the Worker. The capability expiry remains supplied by the Worker (currently 24 hours after successful verification).

# Current eligibility labels

Base: PR179, bc5e5a1017f518bdd8ac87d7f52dc65c6c091388.

The backend's explicit eligibility flag controls current availability. Historical
quote failures remain visible, with their date when supplied. Suspension and
unsupported states remain restrictions. A contradictory explicit negative flag
never offers a quote, and hiring still requires the existing prepare_hire action.

No API, policy, cache or request changes. Added requests: zero.

Validation: initial targeted regression RED (7 failures), then GREEN; final
targeted suite 82 tests. Full frontend suite 170 files / 1,581 tests passed before
adding the final contradictory-negative regression; types and production build
passed. Local fixture checked in desktop and 390px viewport: both card and detail
show current eligibility, dated history and the buyer-quote requirement. Suspended
fixture remains unavailable. Temporary fixture route removed before commit.

Existing SDK dynamic-dependency build warning remains. No seller or D1 requests
were used for visual verification. This change does not renew any evidence.

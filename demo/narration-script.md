# Narration Script — zelosify-hiring-demo.mp4

Timed to the actual recorded video (`zelosify-hiring-demo.mp4`, ~4:43). Play the video back
and read each line around the timestamp shown — they're accurate to within a few seconds,
since the pacing was scripted. Don't worry about hitting them exactly; just talk to what's
on screen.

---

**[0:00]** *(blank registration form on screen)*

> "Hi — this is a demo of the contract hiring module I built: a multi-tenant platform for IT
> vendors and hiring managers, with strict role-based access control and an LLM-powered
> recommendation agent that scores candidates deterministically. Let me walk through it."

**[0:28]** *(form fields filling in)*

> "First, vendor registration. I'll set the role to IT Vendor, and the Organization ID here
> is the tenant ID for the seeded tenant, Bruce Wayne Corp."

**[0:36]** *(about to click Create Account)*

> "On submit, the backend creates the user in Keycloak, generates a TOTP secret, and hands
> back a QR code — it's never exposed again after this screen."

**[0:38]** *(QR code screen appears)*

> "Now I'll scan this into my authenticator app and enter the live six-digit code to finish
> two-factor setup."

**[0:56]** *(entering the code)*

> "That logs me straight in and proves the TOTP loop works end to end."

**[1:00]** *(fresh login page)*

> "Let me sign out and log back in the normal way, to show the returning-user flow —
> username and password first—"

**[1:08]** *(TOTP challenge screen)*

> "—then the TOTP challenge again, with a fresh code."

**[1:22]** *(landed on /vendor/openings)*

> "And I land on the vendor workspace. This is every open contract role under this tenant —
> location, contract type, and the assigned hiring manager. Tenant isolation is enforced on
> every query here, not just hidden in the UI."

**[1:34]** *(opening detail page)*

> "Opening detail shows the experience range, description, required skills, and how many
> profiles have been submitted."

**[1:40]** *(files queued in the dropzone)*

> "I'll drag and drop two candidate profiles — one PDF, one PowerPoint — uploaded in one
> batch, straight to storage through a presigned flow. The frontend never touches S3
> directly."

**[1:46]** *("3 profiles submitted successfully")*

> "Submitted. And to show soft-delete—"

**[1:53]** *(profile removed from the list)*

> "—I can remove one without destroying the record, just flagging it hidden."

**[1:57]** *(redirected to /user)*

> "Now — as this vendor, if I try to hit the hiring manager's route directly—"

**[2:03]** *(still on /user)*

> "—I'm bounced straight back. That's enforced server-side on every request, so there's no
> bypassable endpoint."

**[2:06]** *(fresh login page)*

> "Let's switch personas — signing in as the hiring manager."

**[2:18]** *(landed on /hiring-manager/openings)*

> "And this account lands directly on the hiring manager's workspace."

**[2:26]** *(opening detail, candidate cards showing "Processing")*

> "Here's the opening the vendor just submitted to — two candidate profiles, picked up
> automatically by the recommendation agent the moment they were submitted. Right now
> they're queued; the agent runs asynchronously so the UI never blocks."

**[2:30–3:36]** *(hold on this screen while explaining the architecture)*

> "Under the hood, this isn't a single LLM call. A tool-calling agent decides when to parse
> the resume, extract structured features, normalize the skills against a canonical
> dictionary, run a deterministic matching engine, and calculate the final weighted score —
> fifty percent skill match, thirty percent experience match, twenty percent location match.
> The LLM reasons about *which* tools to call and produces the explanation; it never
> calculates the score itself, so the result stays explainable and reproducible. Every tool
> call, latency, and token count gets logged."

**[3:36]** *(scores / or "Review unavailable" resolve)*

> "And here's the result — match score, confidence, processing latency, and a plain-language
> explanation for each candidate."

**[3:41]** *(Shortlist clicked)*

> "I can shortlist a strong match—"

**[3:47]** *(Reject clicked)*

> "—and reject one that doesn't fit, both gated to this hiring manager's own openings only."

**[3:57]** *(dark mode on)*

> "Full dark mode support—"

**[4:00]** *(back to light)*

**[4:10]** *(mobile-width layout)*

> "—and the layout is fully responsive down to mobile width, with virtualized lists for
> large candidate sets."

**[4:13]** *(back to desktop)*

**[4:18]** *(redirected to /user again)*

> "One more check — hiring manager trying to hit the vendor's route directly—"

**[4:23]** *(still on /user)*

> "—blocked again, same server-side guard, both directions."

**[4:38]** *(closing hold — final beat)*

> "That's the full loop: secure multi-tenant auth, strict RBAC enforced on the backend,
> S3-backed file handling, and a real tool-calling AI agent with deterministic, explainable
> scoring. Thanks for watching."

---

### Notes
- If the AI step shows "Review unavailable / Retry assessment" instead of a completed score
  (Groq rate limit), just say: *"This one hit a retry limit on the provider side — the UI
  degrades gracefully and offers a manual retry rather than failing silently."* That's a true
  statement and turns the limitation into a feature callout.
- Total runtime ≈ 4:43. Timestamps above are accurate to within a few seconds.

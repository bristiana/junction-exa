# junction-exa

Our entry for the **Exa "Internet Butler / Your Personal Assistant"** challenge at Junction 2026 (Espoo, 13–15 Nov 2026).

## The challenge
Build a personal agent that takes a tedious task off people's hands. It searches the live web with [Exa](https://exa.ai), works out what needs to happen, and gets the task as close to done as it can. The user gives the final approval.

**Judged on:**
- how well it uses Exa to find information that isn't in a model's training data;
- how useful it is to a specific group of real people;
- how clearly it shows its sources;
- originality;
- whether the demo works on live queries, including ones the judges try themselves.

## Status
The idea isn't picked yet. The candidates:
1. **Can I fly my drone here?** Checks local drone rules, restricted zones and NOTAMs, with sources, then drafts the permit request.
2. **Moving-to-Finland helper for international students.** Covers the residence permit, registration, insurance, housing and benefits.
3. **EU261 flight-disruption claims.** Checks whether a delayed or cancelled flight qualifies for compensation and drafts the claim.

## Setup
Copy `.env.example` to `.env` and fill in your keys. Never commit `.env`.

## Deadline
The final submission is due **Sun 15 Nov, 10:00** (Helsinki). Aim to submit by 09:30.

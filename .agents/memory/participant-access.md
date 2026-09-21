---
name: Participant access
description: The chosen onboarding and account-provisioning rule for ByB participants.
---

Participants create their own Clerk account and choose their own password. Access to a participant profile is granted only when the verified primary email exactly matches an unclaimed participant previously added through Beheer. Do not restore Clerk invitation tickets or shared/temporary passwords.

**Why:** Real invitation-ticket links repeatedly failed in production, while direct Clerk registration and verified-email claiming completed successfully. The user explicitly preferred this simpler flow.

**How to apply:** Keep Beheer as the email allowlist. Any future onboarding changes must preserve verified-email matching and ensure removing a linked participant also revokes the associated login account.
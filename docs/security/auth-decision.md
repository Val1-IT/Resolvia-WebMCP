# Authentication and ownership decision

The approved target is Google Identity Platform Google sign-in with Firebase Admin verification of a 12-hour `Secure`, `HttpOnly`, `SameSite=Lax` session cookie. Session exchange must require recent sign-in, origin/CSRF validation, and an allowlisted account. Authorization happens on the server before a case read or action. Browser Firestore rules deny direct access.

The domain and store require immutable `ownerUserId`, and `authorizeCaseAccess` enforces owner/admin isolation before case loads and actions. The local implementation now includes Firebase Admin ID/session verification with revocation checking, recent-auth and origin/CSRF session exchange, allowlisted users/admins, login/logout routes, and deny-all browser Firestore rules. This is not a connected-auth completion claim: G11 provider configuration, approved accounts/domains, connected owner migration, and cross-user connected E2E still require manual approval. Until those pass, `resolvia-web` must remain IAM-private and G12 public exposure is prohibited.

Provider signatures, partner tokens, Pub/Sub OIDC, and Cloud Scheduler OIDC authenticate their own narrow ingress paths. None is a browser user session, and none promotes evidence truth by itself.

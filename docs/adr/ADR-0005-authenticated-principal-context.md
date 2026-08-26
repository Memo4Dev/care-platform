# ADR-0005: Trusted Authenticated Principal Context

Status: Accepted

Application services accept only trusted `AuthenticatedPrincipal` contexts.
They never treat DTO identity IDs, roles, or a claimed system mode as proof.
Platform users are resolved from a verified Supabase subject through the
server-side principal resolver; platform RBAC remains database-backed.
`SYSTEM_SERVICE` contexts are constructed only by the server factory and require
an explicit capability for internal provisioning.

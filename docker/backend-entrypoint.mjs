// The inherited role middleware needs the realm's public key at module load.
// Resolve it from this stack's Keycloak, rather than copying a key by hand.
if (!process.env.KEYCLOAK_RS256_SIG) {
  const response = await fetch(
    `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw new Error(`Keycloak realm lookup failed: ${response.status}`);
  const realm = await response.json();
  if (!realm.public_key) throw new Error("Keycloak realm has no public key");
  process.env.KEYCLOAK_RS256_SIG = realm.public_key;
}
await import("./dist/index.js");

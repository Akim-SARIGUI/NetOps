const apiBase = process.env.API_BASE ?? "http://127.0.0.1:4000";
const webBase = process.env.WEB_BASE ?? "http://127.0.0.1:3000";
const password = "NetOps-Demo-2026!";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(email) {
  const response = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function api(path, { token, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`réponse non JSON (${response.status}) sur ${method} ${path}`);
    }
  }
  return { status: response.status, body: payload };
}

const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`ko  ${name}: ${error.message}`);
  }
}

await check("santé API", async () => {
  const { status, body } = await api("/api/health");
  assert(status === 200 && body.database === "ok", `status ${status}`);
});

await check("login refusé", async () => {
  const result = await login("viewer@netops.local");
  result.body = (await login("viewer@netops.local")).body;
  const bad = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "viewer@netops.local", password: "mauvais" }),
  });
  assert(bad.status === 401, `status ${bad.status}`);
});

const viewer = await login("viewer@netops.local");
const operator = await login("operator@netops.local");
const admin = await login("admin@netops.local");
const auditor = await login("auditor@netops.local");
const superAdmin = await login("superadmin@netops.local");

await check("jetons des cinq rôles", async () => {
  for (const session of [viewer, operator, admin, auditor, superAdmin]) {
    assert(session.status === 200 && session.body.token, `login ${session.status}`);
  }
  assert(superAdmin.body.user.isSuperAdmin === true, "super admin");
  assert(viewer.body.memberships[0].role === "VIEWER", "rôle lecteur");
});

await check("session sans jeton", async () => {
  const { status } = await api("/api/v1/auth/me");
  assert(status === 401, `status ${status}`);
});

await check("session avec jeton", async () => {
  const { status, body } = await api("/api/v1/auth/me", { token: viewer.body.token });
  assert(status === 200 && body.user.email === "viewer@netops.local", `status ${status}`);
});

const orgs = await api("/api/v1/organizations", { token: viewer.body.token });
const demo = orgs.body.data.find((organization) => organization.slug === "netops-demo");

await check("lecteur voit la démo", async () => {
  assert(orgs.status === 200 && demo, "organisation absente");
  const sites = await api(`/api/v1/organizations/${demo.id}/sites`, { token: viewer.body.token });
  assert(sites.status === 200 && sites.body.data.some((site) => site.code === "PARIS"), "site Paris absent");
  const paris = sites.body.data.find((site) => site.code === "PARIS");
  const buildings = await api(`/api/v1/sites/${paris.id}/buildings`, { token: viewer.body.token });
  const building = buildings.body.data.find((item) => item.code === "A");
  const rooms = await api(`/api/v1/buildings/${building.id}/rooms`, { token: viewer.body.token });
  const room = rooms.body.data.find((item) => item.code === "MDF");
  const racks = await api(`/api/v1/rooms/${room.id}/racks`, { token: viewer.body.token });
  assert(racks.body.data.some((rack) => rack.code === "R01"), "baie absente");
});

await check("lecteur ne crée pas un site", async () => {
  const { status } = await api(`/api/v1/organizations/${demo.id}/sites`, {
    token: viewer.body.token,
    method: "POST",
    body: { name: "Interdit", code: "NOPE" },
  });
  assert(status === 403, `status ${status}`);
});

await check("lecteur ne lit pas l'audit", async () => {
  const { status } = await api(`/api/v1/organizations/${demo.id}/audit-events`, { token: viewer.body.token });
  assert(status === 403, `status ${status}`);
});

await check("auditeur lit le journal", async () => {
  const { status, body } = await api(`/api/v1/organizations/${demo.id}/audit-events?limit=50&action=seed.bootstrap`, { token: auditor.body.token });
  assert(status === 200 && body.data.some((event) => event.action === "seed.bootstrap"), "journal vide");
});

let createdSiteId = null;

await check("opérateur crée un site et ne le supprime pas", async () => {
  const created = await api(`/api/v1/organizations/${demo.id}/sites`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "Site vérification", code: "VERIFY", environment: "STAGING" },
  });
  if (created.status === 409) {
    const sites = await api(`/api/v1/organizations/${demo.id}/sites`, { token: admin.body.token });
    const existing = sites.body.data.find((site) => site.code === "VERIFY");
    createdSiteId = existing?.id;
  } else {
    assert(created.status === 201, `status ${created.status} ${JSON.stringify(created.body)}`);
    createdSiteId = created.body.id;
  }
  const removed = await api(`/api/v1/sites/${createdSiteId}`, { token: operator.body.token, method: "DELETE" });
  assert(removed.status === 403, `status ${removed.status}`);
});

await check("suppression bloquée si le site a des bâtiments", async () => {
  const sites = await api(`/api/v1/organizations/${demo.id}/sites`, { token: admin.body.token });
  const paris = sites.body.data.find((site) => site.code === "PARIS");
  const removed = await api(`/api/v1/sites/${paris.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removed.status === 409, `status ${removed.status}`);
});

await check("administrateur supprime le site vide", async () => {
  const removed = await api(`/api/v1/sites/${createdSiteId}`, { token: admin.body.token, method: "DELETE" });
  assert(removed.status === 200, `status ${removed.status}`);
});

await check("isolation entre organisations", async () => {
  const created = await api("/api/v1/organizations", {
    token: superAdmin.body.token,
    method: "POST",
    body: { name: "Organisation isolée", slug: "org-isolee" },
  });
  const organizationId = created.status === 201 ? created.body.id : null;
  assert(organizationId || created.status === 409, `création ${created.status}`);
  const id = organizationId ?? (await api("/api/v1/organizations", { token: superAdmin.body.token })).body.data.find((item) => item.slug === "org-isolee").id;
  const hidden = await api(`/api/v1/organizations/${id}/sites`, { token: viewer.body.token });
  assert(hidden.status === 404, `status ${hidden.status}`);
  const removed = await api(`/api/v1/organizations/${id}`, { token: superAdmin.body.token, method: "DELETE" });
  assert(removed.status === 200, `suppression ${removed.status}`);
});

await check("VLAN et commutation", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  assert(organization, "organisation démo absente");
  const sites = await api(`/api/v1/organizations/${organization.id}/sites`, { token: admin.body.token });
  const paris = sites.body.data.find((item) => item.code === "PARIS");
  assert(paris, "site Paris absent");

  const vlans = await api(`/api/v1/organizations/${organization.id}/vlans?siteId=${paris.id}`, { token: viewer.body.token });
  assert(vlans.status === 200, `liste VLAN ${vlans.status}`);
  const byVid = Object.fromEntries(vlans.body.data.map((vlan) => [vlan.vid, vlan]));
  assert(byVid[10] && byVid[20] && byVid[30] && byVid[99], "VLAN de démonstration incomplets");

  const denied = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: viewer.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 200, name: "Temporaire", role: "DATA", securityZone: "TRUST" },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);

  const invalid = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 0, name: "Invalide", role: "DATA", securityZone: "TRUST" },
  });
  assert(invalid.status === 422, `VLAN ID ${invalid.status}`);

  const duplicate = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 10, name: "Doublon", role: "DATA", securityZone: "TRUST" },
  });
  assert(duplicate.status === 409, `doublon ${duplicate.status}`);

  const created = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 200, name: "Temporaire", description: "Vérification", role: "GUEST", securityZone: "GUEST" },
  });
  assert(created.status === 201, `création VLAN ${created.status}`);

  const devices = await api(`/api/v1/organizations/${organization.id}/devices?role=SWITCH`, { token: admin.body.token });
  const sw = devices.body.data.find((item) => item.hostname === "sw-access-a");
  assert(sw, "commutateur absent");
  const view = await api(`/api/v1/devices/${sw.id}/switching`, { token: viewer.body.token });
  assert(view.status === 200, `synthèse ${view.status}`);
  assert(view.body.tree.includes("Gi0/1 → TRUNK"), "trunk Gi0/1 absent");
  assert(view.body.tree.includes("Gi0/3 → VLAN 10"), "access Gi0/3 absent");
  assert(view.body.tree.includes("Gi0/4 → VLAN 20"), "access Gi0/4 absent");
  assert(view.body.tree.includes("Gi0/5 → VLAN 30"), "access Gi0/5 absent");
  assert(view.body.tree.trimEnd().endsWith("└── Gi0/5 → VLAN 30"), "dernier port de l'arbre");

  const access = await api(`/api/v1/devices/${sw.id}/ports`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "Gi0/9", mode: "ACCESS", accessVlanId: created.body.id, status: "UP" },
  });
  assert(access.status === 201 && access.body.mode === "ACCESS", `port access ${access.status}`);

  const accessEmpty = await api(`/api/v1/devices/${sw.id}/ports`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "Gi0/19", mode: "ACCESS" },
  });
  assert(accessEmpty.status === 422, `access sans VLAN ${accessEmpty.status}`);

  const accessList = await api(`/api/v1/devices/${sw.id}/ports`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "Gi0/29", mode: "ACCESS", accessVlanId: byVid[10].id, allowedVlanIds: [byVid[20].id] },
  });
  assert(accessList.status === 422, `access multi-VLAN ${accessList.status}`);

  const trunk = await api(`/api/v1/devices/${sw.id}/ports`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "Gi0/8", mode: "TRUNK", allowedVlanIds: [byVid[10].id, created.body.id], nativeVlanId: created.body.id },
  });
  assert(trunk.status === 201, `trunk ${trunk.status}`);

  const trunkEmpty = await api(`/api/v1/devices/${sw.id}/ports`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "Gi0/18", mode: "TRUNK", allowedVlanIds: [] },
  });
  assert(trunkEmpty.status === 422, `trunk vide ${trunkEmpty.status}`);

  const nativeOutside = await api(`/api/v1/devices/${sw.id}/ports`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "Gi0/28", mode: "TRUNK", allowedVlanIds: [byVid[10].id], nativeVlanId: byVid[20].id },
  });
  assert(nativeOutside.status === 422, `natif hors liste ${nativeOutside.status}`);

  const blocked = await api(`/api/v1/vlans/${created.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(blocked.status === 409, `suppression silencieuse ${blocked.status}`);

  for (const portId of [access.body.id, trunk.body.id]) {
    const removed = await api(`/api/v1/ports/${portId}`, { token: admin.body.token, method: "DELETE" });
    assert(removed.status === 200, `retrait port ${removed.status}`);
  }
  const removedVlan = await api(`/api/v1/vlans/${created.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removedVlan.status === 200, `retrait VLAN ${removedVlan.status}`);
});

await check("IPAM", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const sites = await api(`/api/v1/organizations/${organization.id}/sites`, { token: admin.body.token });
  const paris = sites.body.data.find((item) => item.code === "PARIS");
  const overview = await api(`/api/v1/organizations/${organization.id}/ipam?siteId=${paris.id}`, { token: viewer.body.token });
  assert(overview.status === 200, `liste ${overview.status}`);
  const users = overview.body.networks.flatMap((network) => network.subnets).find((subnet) => subnet.cidr === "10.1.10.0/24");
  assert(users, "sous-réseau utilisateurs absent");
  assert(users.stats.usable === "254" && users.stats.broadcast === "10.1.10.255", "calcul du /24");
  assert(Number(users.stats.used) >= 3, "adresses utilisées");
  assert(overview.body.orphans.length === 0, "des IP d'interface restent hors plan");

  const detail = await api(`/api/v1/subnets/${users.id}`, { token: viewer.body.token });
  assert(detail.status === 200 && detail.body.grid.length === 256, "grille d'occupation");
  assert(detail.body.gateway.address === "10.1.10.1", "passerelle");
  assert(detail.body.addresses.some((item) => item.address === "10.1.10.25" && item.interface), "allocation du poste");

  const denied = await api(`/api/v1/organizations/${organization.id}/networks`, {
    token: viewer.body.token,
    method: "POST",
    body: { siteId: paris.id, name: "Temporaire", cidr: "10.50.0.0/16" },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);

  const plan = await api(`/api/v1/organizations/${organization.id}/ipam/plan`, {
    token: viewer.body.token,
    method: "POST",
    body: { cidr: "10.2.0.0/24", requests: [{ name: "A", hosts: 50 }, { name: "B", hosts: 20 }] },
  });
  assert(plan.status === 200 && plan.body.feasible === true && plan.body.subnets[0].cidr === "10.2.0.0/26", "VLSM");
  const impossible = await api(`/api/v1/organizations/${organization.id}/ipam/plan`, {
    token: viewer.body.token,
    method: "POST",
    body: { cidr: "10.2.0.0/24", requests: [{ name: "A", hosts: 100 }, { name: "B", hosts: 100 }, { name: "C", hosts: 100 }] },
  });
  assert(impossible.status === 200 && impossible.body.feasible === false, "VLSM impossible");

  const network = await api(`/api/v1/organizations/${organization.id}/networks`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id, name: "Vérification", cidr: "10.50.0.0/16" },
  });
  assert(network.status === 201, `réseau ${network.status}`);
  const campus = overview.body.networks.find((network) => network.cidr === "10.1.0.0/16");
  assert(campus, "réseau campus absent");
  const overlap = await api(`/api/v1/organizations/${organization.id}/subnets`, {
    token: operator.body.token,
    method: "POST",
    body: { networkId: campus.id, vlanId: detail.body.vlan.id, name: "Chevauchement", cidr: "10.1.10.128/25", gateway: "10.1.10.129" },
  });
  assert(overlap.status === 409, `chevauchement ${overlap.status}`);
  const outsideParent = await api(`/api/v1/organizations/${organization.id}/subnets`, {
    token: operator.body.token,
    method: "POST",
    body: { networkId: network.body.id, vlanId: detail.body.vlan.id, name: "Hors réseau", cidr: "10.1.10.0/24", gateway: "10.1.10.1" },
  });
  assert(outsideParent.status === 422, `hors réseau parent ${outsideParent.status}`);
  const badGateway = await api(`/api/v1/organizations/${organization.id}/subnets`, {
    token: operator.body.token,
    method: "POST",
    body: { networkId: network.body.id, vlanId: detail.body.vlan.id, name: "Passerelle", cidr: "10.50.1.0/24", gateway: "10.9.9.9" },
  });
  assert(badGateway.status === 422, `passerelle ${badGateway.status}`);
  const created = await api(`/api/v1/organizations/${organization.id}/subnets`, {
    token: operator.body.token,
    method: "POST",
    body: { networkId: network.body.id, vlanId: detail.body.vlan.id, name: "Temporaire", cidr: "10.50.1.0/24", gateway: "10.50.1.1" },
  });
  assert(created.status === 201, `sous-réseau ${created.status}`);
  const outside = await api(`/api/v1/subnets/${created.body.id}/addresses`, {
    token: operator.body.token,
    method: "POST",
    body: { role: "RESERVED", address: "10.9.9.9", description: "Hors subnet" },
  });
  assert(outside.status === 422, `IP hors subnet ${outside.status}`);
  const duplicate = await api(`/api/v1/subnets/${users.id}/addresses`, {
    token: operator.body.token,
    method: "POST",
    body: { role: "RESERVED", address: "10.1.10.25", description: "Doublon" },
  });
  assert(duplicate.status === 409, `IP dupliquée ${duplicate.status}`);
  const blocked = await api(`/api/v1/subnets/${users.id}`, { token: admin.body.token, method: "DELETE" });
  assert(blocked.status === 409, `suppression ${blocked.status}`);
  const removedSubnet = await api(`/api/v1/subnets/${created.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removedSubnet.status === 200, `retrait sous-réseau ${removedSubnet.status}`);
  const removedNetwork = await api(`/api/v1/networks/${network.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removedNetwork.status === 200, `retrait réseau ${removedNetwork.status}`);
});

await check("VLAN relié à l'adressage", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const sites = await api(`/api/v1/organizations/${organization.id}/sites`, { token: admin.body.token });
  const paris = sites.body.data.find((item) => item.code === "PARIS");
  const vlans = await api(`/api/v1/organizations/${organization.id}/vlans?siteId=${paris.id}`, { token: viewer.body.token });
  const voice = vlans.body.data.find((vlan) => vlan.vid === 20);
  const fabric = await api(`/api/v1/vlans/${voice.id}`, { token: viewer.body.token });
  assert(fabric.status === 200, `fiche ${fabric.status}`);
  assert(fabric.body.subnets.some((subnet) => subnet.cidr === "10.1.20.0/24" && subnet.gateway.address === "10.1.20.1"), "chaîne VLAN 20");
  assert(fabric.body.switches.some((device) => device.hostname === "sw-access-a"), "commutateur du VLAN");
  assert(fabric.body.ports.some((port) => port.name === "Gi0/4" && port.connectedDevice?.hostname === "ap-hall"), "port et équipement");
  assert(fabric.body.issues.some((issue) => issue.code === "CONNECTED_OFF_SUBNET"), "alerte d'incohérence");

  const denied = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: viewer.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 220, name: "RH", role: "DATA", securityZone: "TRUST", cidr: "192.168.220.0/24", gateway: "192.168.220.1" },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);

  const created = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 220, name: "RH", role: "DATA", securityZone: "TRUST", cidr: "192.168.220.0/24", gateway: "192.168.220.1" },
  });
  assert(created.status === 201, `création ${created.status}`);
  const overlap = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 221, name: "RH bis", role: "DATA", securityZone: "TRUST", cidr: "192.168.220.128/25", gateway: "192.168.220.129" },
  });
  assert(overlap.status === 409, `chevauchement ${overlap.status}`);
  const badGateway = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 222, name: "Hors", role: "DATA", securityZone: "TRUST", cidr: "192.168.222.0/24", gateway: "10.9.9.9" },
  });
  assert(badGateway.status === 422, `passerelle ${badGateway.status}`);
  const invalid = await api(`/api/v1/organizations/${organization.id}/vlans`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id, vid: 223, name: "Invalide", role: "DATA", securityZone: "TRUST", cidr: "192.168.223.5/24", gateway: "192.168.223.1" },
  });
  assert(invalid.status === 422, `préfixe ${invalid.status}`);
  const after = await api(`/api/v1/organizations/${organization.id}/vlans?siteId=${paris.id}`, { token: admin.body.token });
  assert(after.body.data.some((vlan) => vlan.vid === 220), "VLAN 220 absent");
  assert(!after.body.data.some((vlan) => vlan.vid === 221 || vlan.vid === 222 || vlan.vid === 223), "un VLAN refusé est resté");

  const rh = after.body.data.find((vlan) => vlan.vid === 220);
  const rhFabric = await api(`/api/v1/vlans/${rh.id}`, { token: admin.body.token });
  const subnetId = rhFabric.body.subnets[0].id;
  const removedSubnet = await api(`/api/v1/subnets/${subnetId}`, { token: admin.body.token, method: "DELETE" });
  assert(removedSubnet.status === 200, `retrait sous-réseau ${removedSubnet.status}`);
  const overview = await api(`/api/v1/organizations/${organization.id}/ipam?siteId=${paris.id}`, { token: admin.body.token });
  const network = overview.body.networks.find((item) => item.cidr === "192.168.220.0/24");
  if (network) {
    const removedNetwork = await api(`/api/v1/networks/${network.id}`, { token: admin.body.token, method: "DELETE" });
    assert(removedNetwork.status === 200, `retrait réseau ${removedNetwork.status}`);
  }
  const removedVlan = await api(`/api/v1/vlans/${rh.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removedVlan.status === 200, `retrait VLAN ${removedVlan.status}`);
});

await check("DHCP simulé", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const overview = await api(`/api/v1/organizations/${organization.id}/dhcp`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.mode === "SIMULATION", `vue ${overview.status}`);
  assert(overview.body.notice.includes("Aucun serveur DHCP réel"), "la simulation se présente comme un serveur réel");
  const voice = overview.body.scopes.find((scope) => scope.subnet.cidr === "10.1.20.0/24");
  assert(voice, "scope du VLAN 20 absent");
  assert(voice.vlan.vid === 20 && voice.gateway === "10.1.20.1", "chaîne VLAN et passerelle");
  assert(voice.pools.some((pool) => pool.start === "10.1.20.100" && pool.end === "10.1.20.200"), "pool");
  assert(voice.dnsServers.includes("10.0.0.10") && voice.domain === "netops.local" && voice.leaseSeconds === 28800, "options DHCP");
  assert(overview.body.leases.some((lease) => lease.address === "10.1.20.100" && lease.origin === "SIMULATION"), "bail simulé");
  assert(overview.body.relays.some((relay) => relay.helperAddress === "10.0.0.10" && relay.subnet.vlan.vid === 20), "relais");
  assert(BigInt(voice.stats.available) > 0n, "adresses disponibles");

  const denied = await api(`/api/v1/organizations/${organization.id}/dhcp/servers`, {
    token: viewer.body.token,
    method: "POST",
    body: { siteId: voice.site.id, name: "interdit", address: "10.9.9.9" },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);

  const outside = await api(`/api/v1/dhcp/scopes/${voice.id}/pools`, {
    token: operator.body.token,
    method: "POST",
    body: { start: "192.168.21.10", end: "192.168.21.20" },
  });
  assert(outside.status === 422, `pool hors subnet ${outside.status}`);
  const overlap = await api(`/api/v1/dhcp/scopes/${voice.id}/pools`, {
    token: operator.body.token,
    method: "POST",
    body: { start: "10.1.20.150", end: "10.1.20.180" },
  });
  assert(overlap.status === 409, `chevauchement ${overlap.status}`);
  const badGateway = await api(`/api/v1/dhcp/scopes/${voice.id}`, {
    token: operator.body.token,
    method: "PATCH",
    body: { gateway: "10.9.9.9" },
  });
  assert(badGateway.status === 422, `passerelle ${badGateway.status}`);
  const reservedGateway = await api(`/api/v1/dhcp/scopes/${voice.id}/reservations`, {
    token: operator.body.token,
    method: "POST",
    body: { address: "10.1.20.1", macAddress: "00:11:22:33:44:55" },
  });
  assert(reservedGateway.status === 409, `réservation ${reservedGateway.status}`);

  const leftover = overview.body.scopes.find((scope) => scope.subnet.cidr === "10.1.30.0/24");
  if (leftover) {
    const cleaned = await api(`/api/v1/dhcp/scopes/${leftover.id}`, { token: admin.body.token, method: "DELETE" });
    assert(cleaned.status === 200, `nettoyage scope serveurs ${cleaned.status}`);
  }
  const refreshed = leftover
    ? await api(`/api/v1/organizations/${organization.id}/dhcp`, { token: viewer.body.token })
    : overview;
  const serversSubnet = refreshed.body.scopes.find((scope) => scope.subnet.cidr === "10.1.30.0/24");
  assert(!serversSubnet, "le VLAN serveurs a déjà un scope");
  const ipam = await api(`/api/v1/organizations/${organization.id}/ipam`, { token: admin.body.token });
  const servers = ipam.body.networks.flatMap((network) => network.subnets).find((subnet) => subnet.cidr === "10.1.30.0/24");
  const server = refreshed.body.servers.find((item) => item.name === "dhcp-paris");
  const created = await api(`/api/v1/organizations/${organization.id}/dhcp/scopes`, {
    token: operator.body.token,
    method: "POST",
    body: {
      subnetId: servers.id,
      serverId: server.id,
      gateway: "10.1.30.1",
      dnsServers: ["10.0.0.10"],
      domain: "netops.local",
      pool: { start: "10.1.30.50", end: "10.1.30.50" },
    },
  });
  assert(created.status === 201, `scope temporaire ${created.status}`);
  const first = await api(`/api/v1/dhcp/scopes/${created.body.id}/simulate`, {
    token: operator.body.token,
    method: "POST",
    body: { macAddress: "00:aa:bb:cc:dd:01", hostname: "poste-test" },
  });
  assert(first.status === 201 && first.body.address === "10.1.30.50" && first.body.origin === "SIMULATION", `simulation ${first.status}`);
  const exhausted = await api(`/api/v1/dhcp/scopes/${created.body.id}/simulate`, {
    token: operator.body.token,
    method: "POST",
    body: { macAddress: "00:aa:bb:cc:dd:02" },
  });
  assert(exhausted.status === 409, `pool épuisé ${exhausted.status}`);
  const detail = await api(`/api/v1/dhcp/scopes/${created.body.id}`, { token: viewer.body.token });
  assert(detail.body.issues.some((issue) => issue.code === "POOL_EXHAUSTED"), "alerte d'épuisement absente");
  const removed = await api(`/api/v1/dhcp/scopes/${created.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removed.status === 200, `retrait scope ${removed.status}`);
  const blocked = await api(`/api/v1/subnets/${voice.subnet.id}`, { token: admin.body.token, method: "DELETE" });
  assert(blocked.status === 409, `sous-réseau encore supprimable ${blocked.status}`);
});

await check("DNS local", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const overview = await api(`/api/v1/organizations/${organization.id}/dns?q=intranet`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.mode === "LOCAL", `vue ${overview.status}`);
  assert(overview.body.notice.includes("Aucun serveur DNS réel"), "la résolution se présente comme un serveur réel");
  const zone = overview.body.zones.find((item) => item.name === "entreprise.local");
  assert(zone, "zone entreprise.local absente");
  for (const name of ["intranet", "dns", "dhcp", "monitoring"]) {
    assert(zone.records.some((record) => record.name === name), `${name} absent`);
  }
  const intranet = zone.records.find((record) => record.name === "intranet");
  assert(intranet.link?.address === "10.1.10.25" && intranet.link.device?.hostname === "pc-accueil", "intranet n'est pas relié au poste");
  assert(intranet.link.subnet?.cidr === "10.1.10.0/24" && intranet.link.vlan?.vid === 10, "intranet n'est pas relié au VLAN");
  const denied = await api(`/api/v1/organizations/${organization.id}/dns/servers`, {
    token: viewer.body.token,
    method: "POST",
    body: { siteId: overview.body.servers[0].site.id, name: "interdit" },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);
  const duplicate = await api(`/api/v1/dns/zones/${zone.id}/records`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "intranet", type: "A", value: "10.1.10.25" },
  });
  assert(duplicate.status === 409, `doublon ${duplicate.status}`);
  const cname = await api(`/api/v1/dns/zones/${zone.id}/records`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "intranet", type: "CNAME", value: "dns.entreprise.local" },
  });
  assert(cname.status === 409, `conflit CNAME ${cname.status}`);
  const invalid = await api(`/api/v1/dns/zones/${zone.id}/records`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "hors", type: "A", value: "pas-une-ip" },
  });
  assert(invalid.status === 422, `record invalide ${invalid.status}`);
  const resolved = await api(`/api/v1/dns/zones/${zone.id}/resolve`, {
    token: viewer.body.token,
    method: "POST",
    body: { name: "intranet.entreprise.local" },
  });
  assert(resolved.status === 200 && resolved.body.mode === "LOCAL" && resolved.body.answers[0]?.rdata === "10.1.10.25", `résolution ${resolved.status}`);
  assert(resolved.body.answers[0].link?.device?.hostname === "pc-accueil", "la résolution ne relie pas l'équipement");
  const detail = await api(`/api/v1/dns/zones/${zone.id}`, { token: viewer.body.token });
  assert(detail.body.chain.devices.some((device) => device.hostname === "srv-dc1"), "la chaîne ne montre pas le serveur DNS");
  assert(detail.body.chain.vlans.some((vlan) => vlan.vid === 10), "la chaîne ne montre pas le VLAN");
  assert(detail.body.history.some((change) => change.summary.includes("intranet")), "historique absent");
  const created = await api(`/api/v1/dns/zones/${zone.id}/records`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "probe", type: "TXT", value: "verification" },
  });
  assert(created.status === 201, `création ${created.status}`);
  const removed = await api(`/api/v1/dns/records/${created.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removed.status === 200, `retrait ${removed.status}`);
  const reverse = overview.body.zones.find((item) => item.name === "10.1.10.in-addr.arpa")
    ?? (await api(`/api/v1/organizations/${organization.id}/dns`, { token: viewer.body.token })).body.zones.find((item) => item.name === "10.1.10.in-addr.arpa");
  assert(reverse, "zone inverse absente");
  const outside = await api(`/api/v1/dns/zones/${reverse.id}/records`, {
    token: operator.body.token,
    method: "POST",
    body: { name: "250.1", type: "PTR", value: "dehors.entreprise.local" },
  });
  assert(outside.status === 422, `PTR hors subnet ${outside.status}`);
});

await check("routage prévu", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const overview = await api(`/api/v1/organizations/${organization.id}/routing`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.mode === "PLANNED", `vue ${overview.status}`);
  assert(overview.body.notice.includes("Aucun équipement réel"), "la table se présente comme un routeur réel");
  assert(overview.body.ospfNotice.includes("Aucun voisin"), "OSPF se présente comme négocié");
  const path = overview.body.paths.find((item) => item.fromVlan.vid === 10 && item.toVlan.vid === 40 && item.router.hostname === "core-paris" && item.gateway === "10.1.10.1");
  assert(path, "le chemin VLAN 10 vers VLAN 40 est absent");
  const core = overview.body.devices.find((item) => item.hostname === "core-paris");
  assert(core, "core-paris absent");
  const table = await api(`/api/v1/routing/devices/${core.id}`, { token: viewer.body.token });
  assert(table.status === 200, `table ${table.status}`);
  assert(table.body.routes.some((item) => item.protocol === "CONNECTED" && item.destination === "10.1.10.0"), "route connectée absente");
  assert(table.body.routes.some((item) => item.protocol === "STATIC" && item.cidr === "10.1.30.0/24" && item.gateway === "10.0.0.3"), "route statique absente");
  assert(table.body.routes.some((item) => item.protocol === "DEFAULT" && item.cidr === "0.0.0.0/0"), "route par défaut absente");
  assert(table.body.ospf?.status === "PLANNED", "le processus OSPF n'est pas prévu");
  const denied = await api(`/api/v1/organizations/${organization.id}/routing/routes`, {
    token: viewer.body.token,
    method: "POST",
    body: { deviceId: core.id, protocol: "STATIC", cidr: "10.9.0.0/16", gateway: "10.0.0.3" },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);
  const invalid = await api(`/api/v1/organizations/${organization.id}/routing/routes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: core.id, protocol: "STATIC", cidr: "10.1.30.5/24", gateway: "10.0.0.3" },
  });
  assert(invalid.status === 422, `route invalide ${invalid.status}`);
  const unreachable = await api(`/api/v1/organizations/${organization.id}/routing/routes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: core.id, protocol: "STATIC", cidr: "10.9.0.0/16", gateway: "192.0.2.1" },
  });
  assert(unreachable.status === 422, `passerelle inaccessible ${unreachable.status}`);
  const duplicate = await api(`/api/v1/organizations/${organization.id}/routing/routes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: core.id, protocol: "STATIC", cidr: "10.1.30.0/24", gateway: "10.0.0.3" },
  });
  assert(duplicate.status === 409, `conflit ${duplicate.status}`);
  const ospfRoute = await api(`/api/v1/organizations/${organization.id}/routing/routes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: core.id, protocol: "OSPF", cidr: "10.9.0.0/16", gateway: "10.0.0.3" },
  });
  assert(ospfRoute.status === 422, `route OSPF ${ospfRoute.status}`);
  const leftover = overview.body.routes.find((item) => item.cidr === "198.51.100.0/24");
  if (leftover && !leftover.derived) await api(`/api/v1/routing/routes/${leftover.id}`, { token: admin.body.token, method: "DELETE" });
  const unknown = await api(`/api/v1/organizations/${organization.id}/routing/routes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: core.id, protocol: "STATIC", cidr: "198.51.100.0/24", gateway: "10.0.0.3" },
  });
  assert(unknown.status === 201 && unknown.body.issues.some((issue) => issue.code === "NETWORK_UNKNOWN"), `réseau inexistant ${unknown.status}`);
  const removed = await api(`/api/v1/routing/routes/${unknown.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removed.status === 200, `retrait ${removed.status}`);
});

await check("politique de pare-feu prévue", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const overview = await api(`/api/v1/organizations/${organization.id}/firewall`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.mode === "PLANNED", `vue ${overview.status}`);
  assert(overview.body.notice.includes("Aucun pare-feu physique"), "la politique se présente comme déployée");
  for (const expected of ["GUEST → INTERNET ALLOW", "GUEST → INTERNAL DENY", "IT → SERVERS ALLOW", "IT → MANAGEMENT ALLOW"]) {
    const [source, rest] = expected.split(" → ");
    const [destination, action] = rest.split(" ");
    assert(overview.body.flows.some((rule) => rule.source === source && rule.destination === destination && rule.action === action && rule.enabled), `${expected} absent`);
  }
  const cell = overview.body.matrix.find((item) => item.source.vid === 10 && item.destination.vid === 30);
  assert(cell?.action === "ALLOW" && cell.source.zone === "IT" && cell.destination.zone === "SERVERS", "la matrice VLAN 10 vers VLAN 30 est absente");
  const management = overview.body.matrix.find((item) => item.source.vid === 10 && item.destination.vid === 99);
  assert(management?.action === "ALLOW" && management.destination.zone === "MANAGEMENT", "la matrice vers le management est absente");
  const acl = overview.body.acls.find((item) => item.name === "bordure");
  assert(acl?.device?.hostname === "fw-edge" && acl.status === "PLANNED", "l'ACL de bordure est absente");
  assert(acl.rules.some((rule) => rule.destinationPort === "443" && rule.protocol === "TCP" && rule.action === "ALLOW"), "la règle TCP 443 est absente");
  const denied = await api(`/api/v1/organizations/${organization.id}/firewall/flows`, {
    token: viewer.body.token,
    method: "POST",
    body: { priority: 900, source: "GUEST", destination: "INTERNET", action: "ALLOW" },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);
  const impossible = await api(`/api/v1/organizations/${organization.id}/firewall/flows`, {
    token: operator.body.token,
    method: "POST",
    body: { priority: 910, source: "GUEST", destination: "INTERNET", protocol: "ICMP", destinationPort: "80", action: "DENY" },
  });
  assert(impossible.status === 422, `règle impossible ${impossible.status}`);
  const duplicate = await api(`/api/v1/organizations/${organization.id}/firewall/flows`, {
    token: operator.body.token,
    method: "POST",
    body: { priority: 920, source: "GUEST", destination: "INTERNET", action: "ALLOW" },
  });
  assert(duplicate.status === 409, `doublon ${duplicate.status}`);
  const priority = await api(`/api/v1/organizations/${organization.id}/firewall/flows`, {
    token: operator.body.token,
    method: "POST",
    body: { priority: 100, source: "IT", destination: "SERVERS", action: "DENY" },
  });
  assert(priority.status === 409, `priorité ${priority.status}`);
  const contradiction = await api(`/api/v1/organizations/${organization.id}/firewall/flows`, {
    token: operator.body.token,
    method: "POST",
    body: { priority: 930, source: "GUEST", destination: "INTERNET", action: "DENY" },
  });
  assert(contradiction.status === 201 && contradiction.body.issues.some((issue) => issue.code === "CONTRADICTION"), `contradiction ${contradiction.status}`);
  const removedContradiction = await api(`/api/v1/firewall/flows/${contradiction.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removedContradiction.status === 200, `retrait contradiction ${removedContradiction.status}`);
  const covered = await api(`/api/v1/organizations/${organization.id}/firewall/flows`, {
    token: operator.body.token,
    method: "POST",
    body: { priority: 940, source: "GUEST", destination: "INTERNET", protocol: "TCP", destinationPort: "443", action: "ALLOW" },
  });
  assert(covered.status === 201 && covered.body.issues.some((issue) => issue.code === "IMPOSSIBLE"), `règle couverte ${covered.status}`);
  const removedCovered = await api(`/api/v1/firewall/flows/${covered.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removedCovered.status === 200, `retrait règle couverte ${removedCovered.status}`);
});

await check("topologie d'inventaire", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const overview = await api(`/api/v1/organizations/${organization.id}/topology`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.mode === "INVENTORY", `vue ${overview.status}`);
  assert(overview.body.notice.includes("ne sont pas des équipements réels"), "la simulation n'est pas identifiée");
  assert(overview.body.discoveryNotice.includes("Aucun voisin"), "LLDP se présente comme exécuté");
  for (const hostname of ["core-paris", "sw-access-a", "fw-edge", "srv-dc1", "ap-hall", "pc-accueil"]) {
    const node = overview.body.nodes.find((item) => item.label === hostname);
    assert(node && node.simulated === false && node.kind === "DEVICE", `${hostname} absent ou fictif`);
  }
  const internet = overview.body.nodes.find((item) => item.kind === "INTERNET");
  assert(internet?.simulated === true && internet.label === "Internet", "Internet n'est pas marqué comme simulation");
  const observed = overview.body.links.find((item) => item.origin === "INVENTORY" && item.sourcePort === "Gi0/4");
  assert(observed && observed.targetPort === "eth0" && observed.vlan?.vid === 20 && observed.speedMbps === 1000 && observed.status === "UP" && observed.trafficBps === null && observed.simulated === false, "le lien d'inventaire est absent");
  const simulated = overview.body.links.find((item) => item.origin === "SIMULATION");
  assert(simulated?.sourceId === internet.id && simulated.simulated === true, "le lien Internet n'est pas simulé");
  const lldp = overview.body.discoveries.find((item) => item.protocol === "LLDP");
  const cdp = overview.body.discoveries.find((item) => item.protocol === "CDP");
  assert(lldp?.status === "PLANNED" && cdp?.status === "PLANNED", "la découverte n'est pas préparée");
  const generated = await api(`/api/v1/topology/discoveries/${lldp.id}/generate`, { token: operator.body.token, method: "POST" });
  assert(generated.status === 422, `découverte exécutée ${generated.status}`);
  const searched = await api(`/api/v1/organizations/${organization.id}/topology?q=ap-hall`, { token: viewer.body.token });
  assert(searched.body.nodes.some((item) => item.label === "ap-hall") && !searched.body.nodes.some((item) => item.label === "core-paris"), "la recherche ne filtre pas");
  const denied = await api(`/api/v1/organizations/${organization.id}/topology/markers`, {
    token: viewer.body.token,
    method: "POST",
    body: { siteId: internet.siteId },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);
  const duplicate = await api(`/api/v1/organizations/${organization.id}/topology/markers`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: internet.siteId },
  });
  assert(duplicate.status === 409, `second Internet ${duplicate.status}`);
  const core = overview.body.nodes.find((item) => item.label === "core-paris");
  const moved = await api(`/api/v1/organizations/${organization.id}/topology/placements`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: core.id, x: 510, y: 120 },
  });
  assert(moved.status === 200 && moved.body.simulated === false, `déplacement ${moved.status}`);
  const switchNode = overview.body.nodes.find((item) => item.label === "sw-access-a");
  const leftover = overview.body.links.find((item) => item.origin === "MANUAL" && item.sourcePort === "Gi0/1" && item.targetPort === "Gi0/1");
  if (leftover) await api(`/api/v1/topology/links/${leftover.id}`, { token: admin.body.token, method: "DELETE" });
  const linked = await api(`/api/v1/organizations/${organization.id}/topology/links`, {
    token: operator.body.token,
    method: "POST",
    body: { sourceDeviceId: core.id, targetDeviceId: switchNode.id, sourcePort: "Gi0/1", targetPort: "Gi0/1", speedMbps: 10000, status: "UP" },
  });
  assert(linked.status === 201 && linked.body.origin === "MANUAL" && linked.body.trafficBps === null, `lien manuel ${linked.status}`);
  const removed = await api(`/api/v1/topology/links/${linked.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removed.status === 200, `retrait lien ${removed.status}`);
  const inventoryDelete = await api(`/api/v1/topology/links/${observed.id}`, { token: admin.body.token, method: "DELETE" });
  assert(inventoryDelete.status === 409, `lien d'inventaire supprimé ${inventoryDelete.status}`);
});

await check("découverte simulée", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const sites = await api(`/api/v1/organizations/${organization.id}/sites`, { token: viewer.body.token });
  const paris = sites.body.data.find((item) => item.environment === "PRODUCTION");
  const lab = sites.body.data.find((item) => item.environment === "LAB");
  const before = await api(`/api/v1/organizations/${organization.id}/discovery`, { token: viewer.body.token });
  for (const run of before.body.runs.filter((item) => item.label !== "Démonstration")) {
    await api(`/api/v1/discovery/runs/${run.id}`, { token: admin.body.token, method: "DELETE" });
  }
  const devices = await api(`/api/v1/organizations/${organization.id}/devices`, { token: admin.body.token });
  const leftover = devices.body.data.find((item) => item.hostname === "sw-nouveau");
  if (leftover) {
    const removed = await api(`/api/v1/devices/${leftover.id}`, { token: admin.body.token, method: "DELETE" });
    assert(removed.status === 200, `retrait équipement précédent ${removed.status}`);
  }
  const overview = await api(`/api/v1/organizations/${organization.id}/discovery`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.notice.includes("Aucun équipement réel"), "la découverte se présente comme une interrogation réelle");
  for (const connector of ["ICMP", "ARP", "SNMP", "LLDP", "CDP", "SSH"]) {
    assert(overview.body.connectors.find((item) => item.connector === connector)?.available === false, `${connector} est annoncé disponible`);
  }
  const demo = overview.body.runs.find((item) => item.label === "Démonstration");
  assert(demo?.status === "DISCOVERY", "le dossier de démonstration n'est pas à l'étape découverte");
  for (const verdict of ["DISCOVERED", "UNKNOWN", "MATCHED", "CONFLICT"]) {
    assert(demo.findings.some((item) => item.verdict === verdict), `résultat ${verdict} absent`);
  }
  assert(demo.findings.some((item) => item.hostname === "sw-nouveau" && item.verdict === "DISCOVERED" && item.neighbors.length === 1), "l'équipement simulé n'est pas découvert");
  const denied = await api(`/api/v1/organizations/${organization.id}/discovery/runs`, {
    token: viewer.body.token,
    method: "POST",
    body: { connectors: ["SIMULATION"] },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);
  const silent = await api(`/api/v1/organizations/${organization.id}/discovery/runs`, {
    token: operator.body.token,
    method: "POST",
    body: { connectors: ["ICMP", "SNMP", "SSH"] },
  });
  assert(silent.status === 201 && silent.body.simulated === false && silent.body.findings.length === 0, `connecteurs réels ${silent.status}`);
  assert(silent.body.probes.every((item) => item.available === false), "un connecteur réel a fabriqué une observation");
  const opened = await api(`/api/v1/organizations/${organization.id}/discovery/runs`, {
    token: operator.body.token,
    method: "POST",
    body: { label: "Contrôle", connectors: ["SIMULATION"] },
  });
  assert(opened.status === 201 && opened.body.status === "DISCOVERY", `ouverture ${opened.status}`);
  const early = await api(`/api/v1/discovery/runs/${opened.body.id}/import`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: lab.id },
  });
  assert(early.status === 422, `import anticipé ${early.status}`);
  const reviewed = await api(`/api/v1/discovery/runs/${opened.body.id}/review`, { token: operator.body.token, method: "POST" });
  assert(reviewed.status === 200 && reviewed.body.status === "REVIEW", `revue ${reviewed.status}`);
  const conflict = reviewed.body.findings.find((item) => item.verdict === "CONFLICT");
  const blocked = await api(`/api/v1/discovery/runs/${opened.body.id}/approve`, {
    token: operator.body.token,
    method: "POST",
    body: { decisions: reviewed.body.findings.map((item) => ({ findingId: item.id, decision: item.id === conflict.id ? "ACCEPTED" : "REJECTED" })) },
  });
  assert(blocked.status === 422, `conflit accepté ${blocked.status}`);
  const approved = await api(`/api/v1/discovery/runs/${opened.body.id}/approve`, {
    token: operator.body.token,
    method: "POST",
    body: {
      decisions: reviewed.body.findings.map((item) => ({
        findingId: item.id,
        decision: item.verdict === "DISCOVERED" || item.verdict === "MATCHED" ? "ACCEPTED" : "REJECTED",
      })),
    },
  });
  assert(approved.status === 200 && approved.body.status === "APPROVED", `approbation ${approved.status}`);
  const production = await api(`/api/v1/discovery/runs/${opened.body.id}/import`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id },
  });
  assert(production.status === 422, `import production silencieux ${production.status}`);
  const imported = await api(`/api/v1/discovery/runs/${opened.body.id}/import`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: lab.id },
  });
  assert(imported.status === 200 && imported.body.status === "IMPORTED", `import ${imported.status}`);
  const created = imported.body.findings.find((item) => item.hostname === "sw-nouveau");
  assert(created?.importedDevice?.status === "PLANNED", "l'équipement importé n'est pas prévu");
  assert(imported.body.findings.filter((item) => item.importedDevice).length === 1, "un conflit ou une correspondance a été créé");
  const again = await api(`/api/v1/discovery/runs/${opened.body.id}/import`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: lab.id },
  });
  assert(again.status === 422, `second import ${again.status}`);
  const droppedRun = await api(`/api/v1/discovery/runs/${opened.body.id}`, { token: admin.body.token, method: "DELETE" });
  const droppedSilent = await api(`/api/v1/discovery/runs/${silent.body.id}`, { token: admin.body.token, method: "DELETE" });
  const droppedDevice = await api(`/api/v1/devices/${created.importedDevice.id}`, { token: admin.body.token, method: "DELETE" });
  assert(droppedRun.status === 200 && droppedSilent.status === 200 && droppedDevice.status === 200, "nettoyage découverte");
});

await check("automatisation simulée", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const resetPolicy = () => api(`/api/v1/organizations/${organization.id}/automation/policy`, {
    token: operator.body.token,
    method: "PUT",
    body: { automaticCritical: false },
  });
  try {
    await resetPolicy();
    const first = await api(`/api/v1/organizations/${organization.id}/automation`, { token: viewer.body.token });
    assert(first.status === 200 && first.body.notice.includes("Aucune configuration n'est envoyée"), "l'automatisation se présente comme un envoi réel");
    for (const id of ["SSH", "ANSIBLE", "VENDOR_API", "SNMP"]) {
      assert(first.body.integrations.find((item) => item.id === id)?.available === false, `${id} est annoncé disponible`);
    }
    assert(first.body.integrations.find((item) => item.id === "VENDOR_API")?.message.includes("API constructeur"), "l'API constructeur n'est pas nommée");
    assert(first.body.policy.automaticCritical === false, "la politique critique est active par défaut");
    const demo = first.body.jobs.find((item) => item.label === "Route prévue");
    assert(demo?.stage === "DESIRED" && demo.pushed === false && demo.device.hostname === "core-paris", "le travail de démonstration est déjà parti");
    const route = first.body.templates.find((item) => item.name === "Route statique");
    const banner = first.body.templates.find((item) => item.name === "Bannière");
    assert(route?.critical === true && banner?.critical === false, "la criticité des modèles est incorrecte");
    for (const job of first.body.jobs.filter((item) => item.label !== "Route prévue")) {
      await api(`/api/v1/automation/jobs/${job.id}`, { token: admin.body.token, method: "DELETE" });
    }
    const denied = await api(`/api/v1/organizations/${organization.id}/automation/jobs`, {
      token: viewer.body.token,
      method: "POST",
      body: { deviceId: demo.device.id, templateId: route.id, integration: "SIMULATION" },
    });
    assert(denied.status === 403, `lecteur ${denied.status}`);
    const opened = await api(`/api/v1/organizations/${organization.id}/automation/jobs`, {
      token: operator.body.token,
      method: "POST",
      body: {
        deviceId: demo.device.id,
        templateId: route.id,
        integration: "SIMULATION",
        label: "Contrôle route",
        variables: { destination: "10.1.30.0", mask: "255.255.255.0", gateway: "10.0.0.3" },
      },
    });
    assert(opened.status === 201 && opened.body.stage === "DESIRED", `ouverture ${opened.status}`);
    const early = await api(`/api/v1/automation/jobs/${opened.body.id}/deploy`, { token: operator.body.token, method: "POST" });
    assert(early.status === 422, `déploiement anticipé ${early.status}`);
    const validated = await api(`/api/v1/automation/jobs/${opened.body.id}/validate`, { token: operator.body.token, method: "POST" });
    const generated = await api(`/api/v1/automation/jobs/${opened.body.id}/generate`, { token: operator.body.token, method: "POST" });
    const diff = await api(`/api/v1/automation/jobs/${opened.body.id}/diff`, { token: operator.body.token, method: "POST" });
    const dry = await api(`/api/v1/automation/jobs/${opened.body.id}/dry-run`, { token: operator.body.token, method: "POST" });
    assert(validated.status === 200 && generated.body.generatedConfig.includes("ip route 10.1.30.0"), "la génération ne produit pas la route");
    assert(diff.body.critical === true && diff.body.changed === true, "la route n'est pas critique");
    assert(dry.body.dryRunReport.includes("Aucune commande"), "l'essai à blanc envoie une commande");
    const refused = await api(`/api/v1/automation/jobs/${opened.body.id}/approve`, { token: operator.body.token, method: "POST", body: {} });
    assert(refused.status === 422, `approbation critique silencieuse ${refused.status}`);
    const approved = await api(`/api/v1/automation/jobs/${opened.body.id}/approve`, { token: operator.body.token, method: "POST", body: { authorize: true } });
    const backup = await api(`/api/v1/automation/jobs/${opened.body.id}/backup`, { token: operator.body.token, method: "POST" });
    const deployed = await api(`/api/v1/automation/jobs/${opened.body.id}/deploy`, { token: operator.body.token, method: "POST" });
    const verified = await api(`/api/v1/automation/jobs/${opened.body.id}/verify`, { token: operator.body.token, method: "POST" });
    assert(approved.body.authorization === "EXPLICIT", "l'autorisation explicite n'est pas enregistrée");
    assert(backup.body.backupReport.includes("n'a été lue"), "la sauvegarde lit l'équipement");
    assert(deployed.body.pushed === false && deployed.body.stored === true && deployed.body.executionReport.includes("n'est envoyée"), "la simulation pousse la configuration");
    assert(verified.body.verified === true && verified.body.deviceQueried === false && verified.body.verificationReport.includes("n'a pas été relu"), "la vérification relit l'équipement");
    const device = await api(`/api/v1/devices/${demo.device.id}`, { token: viewer.body.token });
    assert(device.body.status === "ACTIVE", "le statut de l'équipement a changé");
    const remote = await api(`/api/v1/organizations/${organization.id}/automation/jobs`, {
      token: operator.body.token,
      method: "POST",
      body: {
        deviceId: demo.device.id,
        templateId: route.id,
        integration: "SSH",
        label: "Contrôle SSH",
        variables: { destination: "10.9.9.0", mask: "255.255.255.0", gateway: "10.0.0.3" },
      },
    });
    for (const step of ["validate", "generate", "diff", "dry-run"]) {
      const moved = await api(`/api/v1/automation/jobs/${remote.body.id}/${step}`, { token: operator.body.token, method: "POST" });
      assert(moved.status === 200, `${step} SSH ${moved.status}`);
    }
    const remoteApproved = await api(`/api/v1/automation/jobs/${remote.body.id}/approve`, { token: operator.body.token, method: "POST", body: { authorize: true } });
    await api(`/api/v1/automation/jobs/${remote.body.id}/backup`, { token: operator.body.token, method: "POST" });
    const remoteDeployed = await api(`/api/v1/automation/jobs/${remote.body.id}/deploy`, { token: operator.body.token, method: "POST" });
    const remoteVerified = await api(`/api/v1/automation/jobs/${remote.body.id}/verify`, { token: operator.body.token, method: "POST" });
    assert(remoteApproved.status === 200 && remoteDeployed.body.pushed === false && remoteDeployed.body.stored === false, "SSH a appliqué une configuration");
    assert(remoteDeployed.body.executionReport.includes("SSH") && remoteVerified.body.verified === false && remoteVerified.body.deviceQueried === false, "SSH a été vérifié sur l'équipement");
    const quiet = await api(`/api/v1/organizations/${organization.id}/automation/jobs`, {
      token: operator.body.token,
      method: "POST",
      body: { deviceId: demo.device.id, templateId: banner.id, integration: "SIMULATION", label: "Contrôle bannière" },
    });
    for (const step of ["validate", "generate", "diff", "dry-run"]) {
      await api(`/api/v1/automation/jobs/${quiet.body.id}/${step}`, { token: operator.body.token, method: "POST" });
    }
    const quietApproved = await api(`/api/v1/automation/jobs/${quiet.body.id}/approve`, { token: operator.body.token, method: "POST", body: {} });
    assert(quietApproved.status === 200 && quietApproved.body.authorization === "WORKFLOW", "une bannière exige une autorisation critique");
    const enabled = await api(`/api/v1/organizations/${organization.id}/automation/policy`, {
      token: operator.body.token,
      method: "PUT",
      body: { automaticCritical: true },
    });
    const policyJob = await api(`/api/v1/organizations/${organization.id}/automation/jobs`, {
      token: operator.body.token,
      method: "POST",
      body: {
        deviceId: demo.device.id,
        templateId: route.id,
        integration: "SIMULATION",
        label: "Contrôle politique",
        variables: { destination: "10.8.8.0", mask: "255.255.255.0", gateway: "10.0.0.3" },
      },
    });
    const policyEarly = await api(`/api/v1/automation/jobs/${policyJob.body.id}/deploy`, { token: operator.body.token, method: "POST" });
    assert(enabled.status === 200 && policyEarly.status === 422, "la politique saute le workflow");
    for (const step of ["validate", "generate", "diff", "dry-run"]) {
      await api(`/api/v1/automation/jobs/${policyJob.body.id}/${step}`, { token: operator.body.token, method: "POST" });
    }
    const policyApproved = await api(`/api/v1/automation/jobs/${policyJob.body.id}/approve`, { token: operator.body.token, method: "POST", body: {} });
    assert(policyApproved.status === 200 && policyApproved.body.authorization === "POLICY", "la politique n'autorise pas la modification critique");
  } finally {
    const current = await api(`/api/v1/organizations/${organization.id}/automation`, { token: admin.body.token });
    for (const job of current.body.jobs.filter((item) => item.label !== "Route prévue")) {
      await api(`/api/v1/automation/jobs/${job.id}`, { token: admin.body.token, method: "DELETE" });
    }
    await resetPolicy();
  }
});

await check("diagnostic guidé", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const overview = await api(`/api/v1/organizations/${organization.id}/diagnostics`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.notice.includes("n'est interrogé"), "le diagnostic se présente comme une mesure réelle");
  assert(overview.body.device?.hostname === "pc-accueil", "le poste d'accueil n'est pas le sujet");
  const labels = overview.body.guide.map((item) => item.label).join(" > ");
  assert(labels === "Client sans IP > Interface > Switch port > VLAN > Trunk > DHCP Relay > DHCP Scope > DHCP Server", "le guide ne suit pas la chaîne");
  for (const item of overview.body.guide) {
    const text = `${item.fact} ${item.observation} ${item.possibleCause}`;
    assert(item.fact && item.observation && item.possibleCause.includes("peut") && item.recommendedCheck, "une étape ne sépare pas fait, observation, cause et contrôle");
    assert(!text.includes("la cause est") && !`${item.fact} ${item.observation}`.includes("a répondu"), "une hypothèse est présentée comme une certitude");
  }
  const relay = overview.body.guide.find((item) => item.label === "DHCP Relay");
  const scope = overview.body.guide.find((item) => item.label === "DHCP Scope");
  assert(relay.fact.includes("Aucun relais") && scope.fact.includes("Aucun scope"), "le relais ou le scope est affirmé à tort");
  const denied = await api(`/api/v1/organizations/${organization.id}/diagnostics`, {
    token: viewer.body.token,
    method: "POST",
    body: { deviceId: overview.body.device.id },
  });
  assert(denied.status === 403, "le lecteur lance un diagnostic");
  const saved = await api(`/api/v1/organizations/${organization.id}/diagnostics`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: overview.body.device.id },
  });
  const live = await api(`/api/v1/organizations/${organization.id}/diagnostics/probes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: overview.body.device.id, tool: "PING", mode: "LIVE" },
  });
  const liveText = JSON.stringify(live.body.checks?.[0] ?? {});
  assert(saved.status === 201 && saved.body.checks.length === 8, "le guide n'est pas enregistré");
  assert(live.status === 201 && live.body.checks[0].available === false && live.body.checks[0].observation.includes("ICMP"), "la sonde ICMP invente un résultat");
  assert(!liveText.includes("10.1.10.25") && !liveText.includes("DOWN"), "la sonde indisponible retombe sur l'inventaire");
  const inventoryPing = await api(`/api/v1/organizations/${organization.id}/diagnostics/probes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: overview.body.device.id, tool: "PING", mode: "INVENTORY" },
  });
  assert(inventoryPing.status === 201 && inventoryPing.body.checks[0].observation.includes("n'a été mesuré") && inventoryPing.body.checks[0].possibleCause.includes("peut"), "le ping d'inventaire conclut");
  const blocked = await api(`/api/v1/organizations/${organization.id}/diagnostics/probes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: overview.body.device.id, tool: "PORT", mode: "INVENTORY", port: 445 },
  });
  assert(blocked.status === 422, "un port non autorisé est testé");
  const allowed = await api(`/api/v1/organizations/${organization.id}/diagnostics/probes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: overview.body.device.id, tool: "PORT", mode: "INVENTORY", port: 80 },
  });
  assert(allowed.status === 201 && allowed.body.checks[0].observation.includes("n'a été exécuté"), "le port autorisé est réellement testé");
  const dns = await api(`/api/v1/organizations/${organization.id}/diagnostics/probes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: overview.body.device.id, tool: "DNS", mode: "INVENTORY" },
  });
  const trace = await api(`/api/v1/organizations/${organization.id}/diagnostics/probes`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: overview.body.device.id, tool: "TRACEROUTE", mode: "INVENTORY" },
  });
  assert(dns.status === 201 && dns.body.checks[0].observation.includes("n'a été interrogé"), "le DNS interroge un résolveur");
  assert(trace.status === 201 && trace.body.checks[0].observation.includes("Aucun traceroute"), "le traceroute est exécuté");
  for (const id of [saved.body.id, live.body.id, inventoryPing.body.id, allowed.body.id, dns.body.id, trace.body.id]) {
    const removed = await api(`/api/v1/diagnostics/${id}`, { token: admin.body.token, method: "DELETE" });
    assert(removed.status === 200, "le diagnostic n'est pas retiré");
  }
});

await check("laboratoire isolé", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const overview = await api(`/api/v1/organizations/${organization.id}/lab`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.notice.includes("isolé"), "le LAB se présente comme la production");
  assert(overview.body.environments.map((item) => item.id).join(",") === "LAB,DEV,STAGING,PRODUCTION", "les environnements sont incomplets");
  const fabric = overview.body.fabrics[0];
  assert(fabric?.site.environment === "LAB" && fabric.nodes.length === 5, "la fabrique LAB est absente");
  assert(fabric.nodes.map((item) => item.role).sort().join(",") === "CLIENT,FIREWALL,ROUTER,SERVER,SWITCH", "l'infrastructure LAB est incomplète");
  assert(fabric.scenarios.map((item) => item.kind).sort().join(",") === "ACL,CONNECTIVITY,DHCP,DNS,ROUTING,VLAN", "les scénarios LAB sont incomplets");
  assert(fabric.scenarios.every((item) => item.ready && item.observation.includes("production")), "un scénario LAB touche la production");
  assert(fabric.nodes.every((item) => item.address.startsWith("10.255.")), "les nœuds LAB ne sont pas isolés");
  const denied = await api(`/api/v1/organizations/${organization.id}/lab`, {
    token: viewer.body.token,
    method: "POST",
    body: { siteId: fabric.site.id },
  });
  assert(denied.status === 403, "le lecteur crée une fabrique");
  const paris = overview.body.sites.find((item) => item.environment === "PRODUCTION");
  const staging = overview.body.sites.find((item) => item.environment === "STAGING");
  const onProd = await api(`/api/v1/organizations/${organization.id}/lab`, {
    token: operator.body.token,
    method: "POST",
    body: { siteId: paris.id },
  });
  assert(onProd.status === 422, "une fabrique LAB est créée en production");
  const early = await api(`/api/v1/lab/${fabric.id}/promotions`, {
    token: operator.body.token,
    method: "POST",
    body: { targetSiteId: paris.id },
  });
  assert(early.status === 422, "LAB peut sauter STAGING");
  const prepared = await api(`/api/v1/lab/${fabric.id}/promotions`, {
    token: operator.body.token,
    method: "POST",
    body: { targetSiteId: staging.id },
  });
  assert(prepared.status === 201 && prepared.body.phase === "PREPARED" && prepared.body.applied === false && prepared.body.pushed === false, "la promotion n'est pas préparée");
  const skipped = await api(`/api/v1/lab/promotions/${prepared.body.id}/promote`, {
    token: operator.body.token,
    method: "POST",
    body: {},
  });
  assert(skipped.status === 422, "la promotion saute la validation");
  const validated = await api(`/api/v1/lab/promotions/${prepared.body.id}/validate`, { token: operator.body.token, method: "POST" });
  assert(validated.status === 200 && validated.body.phase === "VALIDATED", "la validation échoue");
  const promoted = await api(`/api/v1/lab/promotions/${prepared.body.id}/promote`, {
    token: operator.body.token,
    method: "POST",
    body: {},
  });
  assert(promoted.status === 200 && promoted.body.phase === "PROMOTED" && promoted.body.applied === false && promoted.body.pushed === false, "la promotion vers STAGING modifie la cible");
  const nextPrepared = await api(`/api/v1/lab/${fabric.id}/promotions`, {
    token: operator.body.token,
    method: "POST",
    body: { targetSiteId: paris.id, sourcePromotionId: promoted.body.id },
  });
  assert(nextPrepared.status === 201 && nextPrepared.body.sourceEnvironment === "STAGING" && nextPrepared.body.targetEnvironment === "PRODUCTION", "la suite vers PRODUCTION n'est pas préparée");
  await api(`/api/v1/lab/promotions/${nextPrepared.body.id}/validate`, { token: operator.body.token, method: "POST" });
  const blocked = await api(`/api/v1/lab/promotions/${nextPrepared.body.id}/promote`, {
    token: operator.body.token,
    method: "POST",
    body: {},
  });
  assert(blocked.status === 422, "PRODUCTION est promue sans confirmation");
  const production = await api(`/api/v1/lab/promotions/${nextPrepared.body.id}/promote`, {
    token: operator.body.token,
    method: "POST",
    body: { confirmProduction: true },
  });
  assert(production.status === 200 && production.body.phase === "PROMOTED" && production.body.applied === false && production.body.pushed === false && production.body.confirmProduction === true, "la promotion PRODUCTION applique la configuration");
  const removedNext = await api(`/api/v1/lab/promotions/${nextPrepared.body.id}`, { token: admin.body.token, method: "DELETE" });
  const removedFirst = await api(`/api/v1/lab/promotions/${prepared.body.id}`, { token: admin.body.token, method: "DELETE" });
  assert(removedNext.status === 200 && removedFirst.status === 200, "les promotions de contrôle ne sont pas retirées");
});

await check("documentation unifiée", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const overview = await api(`/api/v1/organizations/${organization.id}/documentation`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.notice.includes("Aucun équipement réel"), "la documentation se présente comme une interrogation réelle");
  const ids = overview.body.sections.map((item) => item.id);
  assert(ids.includes("IP_PLAN") && ids.includes("VLAN_MATRIX") && ids.includes("SWITCH_PORT_MATRIX") && ids.includes("DHCP") && ids.includes("DNS") && ids.includes("ROUTING") && ids.includes("FIREWALL_MATRIX") && ids.includes("INVENTORY") && ids.includes("TOPOLOGY") && ids.includes("CONFIGURATION_HISTORY") && ids.includes("NETWORK"), "une section de documentation manque");
  assert(overview.body.relations.some((item) => item.from === "VLAN" && item.to === "IPAM"), "les relations entre modules sont absentes");
  const inventory = overview.body.sections.find((item) => item.id === "INVENTORY");
  assert(inventory.rowCount > 0 && inventory.preview.some((row) => row.hostname === "core-paris"), "l'inventaire documenté est vide");
  const vlan = overview.body.sections.find((item) => item.id === "VLAN_MATRIX");
  assert(vlan.preview.some((row) => Number(row.vid) === 10), "la matrice VLAN est vide");
  const jsonExport = await api(`/api/v1/organizations/${organization.id}/documentation/export?format=JSON`, { token: viewer.body.token });
  const csvExport = await api(`/api/v1/organizations/${organization.id}/documentation/export?format=CSV`, { token: viewer.body.token });
  const pdfExport = await api(`/api/v1/organizations/${organization.id}/documentation/export?format=PDF`, { token: viewer.body.token });
  assert(jsonExport.status === 200 && jsonExport.body.format === "JSON" && jsonExport.body.content.includes("core-paris"), "l'export JSON est incomplet");
  assert(csvExport.status === 200 && csvExport.body.format === "CSV" && csvExport.body.content.includes("hostname"), "l'export CSV est incomplet");
  assert(pdfExport.status === 200 && pdfExport.body.format === "PDF" && pdfExport.body.encoding === "base64" && Buffer.from(pdfExport.body.content, "base64").subarray(0, 5).toString("utf8") === "%PDF-", "l'export PDF est invalide");
  const denied = await api(`/api/v1/organizations/${organization.id}/documentation/export?format=PDF`, {
    token: viewer.body.token,
    method: "POST",
    body: {},
  });
  assert(denied.status === 405 || denied.status === 404 || denied.status === 403, "l'export accepte une écriture");
});

await check("changements tracés", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const source = { "x-forwarded-for": "203.0.113.44" };
  const first = await api(`/api/v1/organizations/${organization.id}/changes`, { token: viewer.body.token });
  for (const request of first.body.requests.filter((item) => item.title !== "Route de secours")) {
    await api(`/api/v1/changes/${request.id}`, { token: admin.body.token, method: "DELETE", headers: source });
  }
  const overview = await api(`/api/v1/organizations/${organization.id}/changes`, { token: viewer.body.token });
  assert(overview.status === 200 && overview.body.notice.includes("n'est lue ni envoyée"), "la gestion des changements se présente comme un envoi réel");
  const demo = overview.body.requests.find((item) => item.title === "Route de secours");
  assert(demo?.phase === "OPEN" && demo.device.hostname === "core-paris" && demo.logs[0]?.result === "RECORDED", "la demande de démonstration n'est pas ouverte");
  assert(demo.logs[0].actor.name && demo.logs[0].sourceAddress === "127.0.0.1" && demo.logs[0].newConfig.includes("10.9.1.0"), "le journal de démonstration est incomplet");
  const denied = await api(`/api/v1/organizations/${organization.id}/changes`, {
    token: viewer.body.token,
    method: "POST",
    headers: source,
    body: { deviceId: demo.device.id, title: "Refus", integration: "SIMULATION", proposedContent: "interdit" },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);
  const opened = await api(`/api/v1/organizations/${organization.id}/changes`, {
    token: operator.body.token,
    method: "POST",
    headers: source,
    body: { deviceId: demo.device.id, title: "Contrôle changement", integration: "SIMULATION", proposedContent: "! Contrôle\nip route 10.9.2.0 255.255.255.0 10.0.0.3" },
  });
  assert(opened.status === 201 && opened.body.logs[0].sourceAddress === "203.0.113.44", `ouverture ${opened.status}`);
  const early = await api(`/api/v1/changes/${opened.body.id}/deploy`, { token: operator.body.token, method: "POST", headers: source });
  assert(early.status === 422, `changement sans sauvegarde ${early.status}`);
  const backed = await api(`/api/v1/changes/${opened.body.id}/backup`, { token: operator.body.token, method: "POST", headers: source });
  assert(backed.status === 200 && backed.body.phase === "BACKED_UP" && backed.body.backup.deviceRead === false, `sauvegarde ${backed.status}`);
  assert(backed.body.backup.notice.includes("n'a été lue") && backed.body.diffText.includes("+ ! Contrôle"), "le diff de configuration est absent");
  const deployed = await api(`/api/v1/changes/${opened.body.id}/deploy`, { token: operator.body.token, method: "POST", headers: source });
  const verified = await api(`/api/v1/changes/${opened.body.id}/verify`, { token: operator.body.token, method: "POST", headers: source });
  assert(deployed.body.phase === "DEPLOYED" && deployed.body.deployments[0].pushed === false, "la simulation pousse la configuration");
  assert(verified.body.phase === "VERIFIED" && verified.body.logs.some((entry) => entry.result === "VERIFIED" && entry.action === "verification"), "la vérification n'est pas tracée");
  const trace = verified.body.logs.at(-1);
  assert(trace.actor.name === "Opérateur réseau" && trace.device.hostname === "core-paris" && trace.oldConfig && trace.newConfig && trace.sourceAddress === "203.0.113.44" && trace.occurredAt.includes("T"), "la trace est incomplète");
  const failed = await api(`/api/v1/organizations/${organization.id}/changes`, {
    token: operator.body.token,
    method: "POST",
    headers: source,
    body: { deviceId: demo.device.id, title: "Contrôle échec", integration: "SSH", proposedContent: "! échec\nip route 10.9.3.0 255.255.255.0 10.0.0.3" },
  });
  await api(`/api/v1/changes/${failed.body.id}/backup`, { token: operator.body.token, method: "POST", headers: source });
  const broken = await api(`/api/v1/changes/${failed.body.id}/deploy`, { token: operator.body.token, method: "POST", headers: source });
  const skipped = await api(`/api/v1/changes/${failed.body.id}/verify`, { token: operator.body.token, method: "POST", headers: source });
  assert(broken.body.phase === "FAILED" && broken.body.deployments[0].pushed === false && broken.body.deployments[0].report.includes("SSH"), "SSH a appliqué le changement");
  assert(skipped.status === 422, `vérification de succès après échec ${skipped.status}`);
  const rolled = await api(`/api/v1/changes/${failed.body.id}/rollback`, { token: operator.body.token, method: "POST", headers: source });
  const rolledCheck = await api(`/api/v1/changes/${failed.body.id}/verify-rollback`, { token: operator.body.token, method: "POST", headers: source });
  const incident = await api(`/api/v1/changes/${failed.body.id}/incident`, { token: operator.body.token, method: "POST", headers: source });
  assert(rolled.body.phase === "ROLLED_BACK" && rolled.body.deployments.some((item) => item.kind === "ROLLBACK" && item.pushed === false), "le rollback pousse une configuration");
  assert(rolledCheck.body.phase === "ROLLBACK_VERIFIED" && incident.body.phase === "INCIDENT" && incident.body.incident.summary.includes("Aucun équipement"), "l'incident n'est pas ouvert");
  const removedOk = await api(`/api/v1/changes/${opened.body.id}`, { token: admin.body.token, method: "DELETE", headers: source });
  const removedFail = await api(`/api/v1/changes/${failed.body.id}`, { token: admin.body.token, method: "DELETE", headers: source });
  assert(removedOk.status === 200 && removedFail.status === 200, "nettoyage des demandes");
});

await check("supervision simulée", async () => {
  const orgs = await api("/api/v1/organizations", { token: admin.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const dashboard = await api(`/api/v1/organizations/${organization.id}/monitoring`, { token: viewer.body.token });
  assert(dashboard.status === 200 && dashboard.body.mode === "SIMULATION", `vue ${dashboard.status}`);
  assert(dashboard.body.notice.includes("Aucun équipement réel"), "la supervision se présente comme une interrogation réelle");
  assert(dashboard.body.collectors.find((item) => item.id === "ICMP")?.available === false, "ICMP est annoncé disponible");
  assert(dashboard.body.collectors.find((item) => item.id === "SNMP")?.available === false, "SNMP est annoncé disponible");
  assert(dashboard.body.totals.devices === 6 && dashboard.body.totals.online === 5 && dashboard.body.totals.offline === 1 && dashboard.body.totals.critical === 1, `compteurs ${dashboard.body.totals.online}/${dashboard.body.totals.offline}`);
  const client = dashboard.body.targets.find((item) => item.device.hostname === "pc-accueil");
  assert(client?.status === "OFFLINE" && client.metrics.availability === 0, "le poste prévu n'est pas hors ligne");
  assert(dashboard.body.alerts.some((alert) => alert.code === "DEVICE_DOWN" && alert.device === "pc-accueil"), "alerte équipement absente");
  assert(dashboard.body.alerts.some((alert) => alert.code === "INTERFACE_DOWN" && alert.message.includes("eth0")), "alerte d'interface absente");
  assert(!dashboard.body.alerts.some((alert) => alert.code === "DNS_UNAVAILABLE"), "le DNS actif est signalé indisponible");
  assert(!dashboard.body.alerts.some((alert) => alert.code === "DHCP_POOL"), "le pool DHCP est signalé saturé");
  assert(typeof dashboard.body.totals.ipUtilization === "number" && typeof dashboard.body.totals.dhcpUtilization === "number" && dashboard.body.vlans.some((vlan) => vlan.vid === 10), "les utilisations réelles sont absentes");
  const core = dashboard.body.targets.find((item) => item.device.hostname === "core-paris");
  assert(core?.metrics.cpu !== null && core.metrics.cpu <= 80 && core.metrics.ram <= 90, "les seuils simulés sont dépassés");
  const denied = await api(`/api/v1/organizations/${organization.id}/monitoring/targets`, {
    token: viewer.body.token,
    method: "POST",
    body: { deviceId: core.device.id },
  });
  assert(denied.status === 403, `lecteur ${denied.status}`);
  const duplicate = await api(`/api/v1/organizations/${organization.id}/monitoring/targets`, {
    token: operator.body.token,
    method: "POST",
    body: { deviceId: core.device.id },
  });
  assert(duplicate.status === 409, `doublon ${duplicate.status}`);
  const icmp = await api(`/api/v1/monitoring/targets/${core.id}`, { token: operator.body.token, method: "PATCH", body: { mode: "ICMP" } });
  assert(icmp.status === 200, `passage ICMP ${icmp.status}`);
  const prepared = await api(`/api/v1/organizations/${organization.id}/monitoring`, { token: viewer.body.token });
  const unknown = prepared.body.targets.find((item) => item.device.hostname === "core-paris");
  assert(unknown?.status === "UNKNOWN" && unknown.metrics.cpu === null && unknown.collectorMessage.includes("ICMP"), "ICMP a fabriqué des mesures");
  const restored = await api(`/api/v1/monitoring/targets/${core.id}`, { token: operator.body.token, method: "PATCH", body: { mode: "SIMULATION" } });
  assert(restored.status === 200, `retour simulation ${restored.status}`);
});

await check("le frontend joint le backend", async () => {
  const health = await fetch(`${webBase}/api/health`);
  const healthBody = await health.json();
  assert(health.status === 200 && healthBody.web === "ok" && healthBody.api.database === "ok", "health web");

  const loginResponse = await fetch(`${webBase}/api/backend/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "viewer@netops.local", password }),
  });
  const loginBody = await loginResponse.json();
  const cookie = loginResponse.headers.get("set-cookie") ?? "";
  assert(loginResponse.status === 200, `login web ${loginResponse.status}`);
  assert(!("token" in loginBody), "le jeton ne doit pas revenir au navigateur");
  assert(cookie.includes("netops_token="), "cookie absent");

  const page = await fetch(`${webBase}/`, { headers: { cookie: cookie.split(";")[0] } });
  const html = await page.text();
  assert(page.status === 200, `page ${page.status}`);
  assert(html.includes("NetOps Démo"), "la page ne contient pas l'organisation renvoyée par l'API");
  assert(!html.includes("Identifiants invalides"), "la page d'accueil a affiché une erreur de login");

  const orgs = await api("/api/v1/organizations", { token: viewer.body.token });
  const organization = orgs.body.data.find((item) => item.slug === "netops-demo");
  const devices = await api(`/api/v1/organizations/${organization.id}/devices?role=SWITCH`, { token: viewer.body.token });
  const sw = devices.body.data.find((item) => item.hostname === "sw-access-a");
  const cookieHeader = { cookie: cookie.split(";")[0] };
  const switchingPage = await fetch(`${webBase}/switching`, { headers: cookieHeader });
  const switchingHtml = await switchingPage.text();
  assert(switchingPage.status === 200, `commutation ${switchingPage.status}`);
  assert(switchingHtml.includes("Utilisateurs"), "les VLAN ne s'affichent pas");
  assert(switchingHtml.includes("sw-access-a"), "le commutateur ne s'affiche pas");
  assert(!switchingHtml.includes("Nouveau VLAN"), "le lecteur voit le formulaire de VLAN");

  const switchPage = await fetch(`${webBase}/switches/${sw.id}`, { headers: cookieHeader });
  const switchHtml = await switchPage.text();
  assert(switchPage.status === 200, `page commutateur ${switchPage.status}`);
  assert(switchHtml.includes("Gi0/1 → TRUNK"), "l'arbre ne montre pas le trunk");
  assert(switchHtml.includes("Gi0/3 → VLAN 10"), "l'arbre ne montre pas le VLAN 10");
  assert(!switchHtml.includes("Créer le port access"), "le lecteur voit le formulaire de port");

  const adminLogin = await fetch(`${webBase}/api/backend/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@netops.local", password }),
  });
  const adminCookie = adminLogin.headers.get("set-cookie") ?? "";
  const adminSwitch = await fetch(`${webBase}/switches/${sw.id}`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminHtml = await adminSwitch.text();
  assert(adminSwitch.status === 200 && adminHtml.includes("Créer le port access"), "l'administrateur ne voit pas la création de port");
  const adminVlans = await fetch(`${webBase}/switching`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminVlanHtml = await adminVlans.text();
  assert(adminVlans.status === 200 && adminVlanHtml.includes("Nouveau VLAN"), "l'administrateur ne voit pas la création de VLAN");

  const ipamPage = await fetch(`${webBase}/ipam`, { headers: cookieHeader });
  const ipamHtml = await ipamPage.text();
  assert(ipamPage.status === 200 && ipamHtml.includes("10.1.10.0/24"), "la page d'adressage ne montre pas le sous-réseau");
  assert(!ipamHtml.includes("Nouveau réseau"), "le lecteur voit le formulaire réseau");
  const ipamData = await api(`/api/v1/organizations/${organization.id}/ipam`, { token: viewer.body.token });
  const usersSubnet = ipamData.body.networks.flatMap((network) => network.subnets).find((subnet) => subnet.cidr === "10.1.10.0/24");
  const subnetPage = await fetch(`${webBase}/subnets/${usersSubnet.id}`, { headers: cookieHeader });
  const subnetHtml = await subnetPage.text();
  assert(subnetPage.status === 200 && subnetHtml.includes("Disponibles") && subnetHtml.includes("10.1.10.1"), "la grille du sous-réseau ne s'affiche pas");
  const adminIpam = await fetch(`${webBase}/ipam`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminIpamHtml = await adminIpam.text();
  assert(adminIpam.status === 200 && adminIpamHtml.includes("Nouveau réseau"), "l'administrateur ne voit pas la création de réseau");
  const vlanList = await api(`/api/v1/organizations/${organization.id}/vlans`, { token: viewer.body.token });
  const voice = vlanList.body.data.find((vlan) => vlan.vid === 20);
  const vlanPage = await fetch(`${webBase}/vlans/${voice.id}`, { headers: cookieHeader });
  const vlanHtml = await vlanPage.text();
  assert(vlanPage.status === 200 && vlanHtml.includes("10.1.20.0/24") && vlanHtml.includes("sw-access-a"), "la fiche VLAN ne montre pas la chaîne");
  assert(vlanHtml.includes("n'a pas d'adresse dans le sous-réseau"), "la fiche VLAN ne montre pas l'alerte");
  const adminSwitching = await fetch(`${webBase}/switching`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminSwitchingHtml = await adminSwitching.text();
  assert(adminSwitching.status === 200 && adminSwitchingHtml.includes("Passerelle"), "le formulaire VLAN ne propose pas la passerelle");
  const dhcpPage = await fetch(`${webBase}/dhcp`, { headers: cookieHeader });
  const dhcpHtml = await dhcpPage.text();
  assert(dhcpPage.status === 200 && dhcpHtml.includes("10.1.20.100") && dhcpHtml.includes("Aucun serveur DHCP réel"), "le tableau DHCP ne s'affiche pas");
  assert(!dhcpHtml.includes("Nouveau scope"), "le lecteur voit la création de scope");
  const adminDhcp = await fetch(`${webBase}/dhcp`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminDhcpHtml = await adminDhcp.text();
  assert(adminDhcp.status === 200 && adminDhcpHtml.includes("Nouveau scope"), "l'administrateur ne voit pas la création de scope");
  const dnsPage = await fetch(`${webBase}/dns?q=intranet`, { headers: cookieHeader });
  const dnsHtml = await dnsPage.text();
  assert(dnsPage.status === 200 && dnsHtml.includes("entreprise.local") && dnsHtml.includes("Aucun serveur DNS réel"), "le tableau DNS ne s'affiche pas");
  assert(!dnsHtml.includes("Nouvelle zone"), "le lecteur voit la création de zone");
  const adminDns = await fetch(`${webBase}/dns`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminDnsHtml = await adminDns.text();
  assert(adminDns.status === 200 && adminDnsHtml.includes("Nouvelle zone"), "l'administrateur ne voit pas la création de zone");
  const dnsData = await api(`/api/v1/organizations/${organization.id}/dns?q=entreprise.local`, { token: viewer.body.token });
  const forward = dnsData.body.zones.find((item) => item.name === "entreprise.local");
  const zonePage = await fetch(`${webBase}/dns/zones/${forward.id}`, { headers: cookieHeader });
  const zoneHtml = await zonePage.text();
  assert(zonePage.status === 200 && zoneHtml.includes("intranet.entreprise.local") && zoneHtml.includes("pc-accueil") && zoneHtml.includes("VLAN 10"), "la chaîne DNS ne s'affiche pas");
  const routingPage = await fetch(`${webBase}/routing`, { headers: cookieHeader });
  const routingHtml = await routingPage.text();
  assert(routingPage.status === 200 && routingHtml.includes("VLAN 10") && routingHtml.includes("VLAN 40") && routingHtml.includes("core-paris") && routingHtml.includes("10.1.10.1"), "le chemin de routage ne s'affiche pas");
  assert(routingHtml.includes("Aucun équipement réel"), "la page de routage se présente comme un routeur réel");
  assert(!routingHtml.includes("Nouvelle route"), "le lecteur voit la création de route");
  const adminRouting = await fetch(`${webBase}/routing`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminRoutingHtml = await adminRouting.text();
  assert(adminRouting.status === 200 && adminRoutingHtml.includes("Nouvelle route"), "l'administrateur ne voit pas la création de route");
  const routingData = await api(`/api/v1/organizations/${organization.id}/routing`, { token: viewer.body.token });
  const routed = routingData.body.devices.find((item) => item.hostname === "core-paris");
  const tablePage = await fetch(`${webBase}/routing/${routed.id}`, { headers: cookieHeader });
  const tableHtml = await tablePage.text();
  assert(tablePage.status === 200 && tableHtml.includes("0.0.0.0/0") && tableHtml.includes("Connectée"), "la table de routage ne s'affiche pas");
  const firewallPage = await fetch(`${webBase}/firewall`, { headers: cookieHeader });
  const firewallHtml = await firewallPage.text();
  assert(firewallPage.status === 200 && firewallHtml.includes("GUEST") && firewallHtml.includes("INTERNET") && firewallHtml.includes("ALLOW") && firewallHtml.includes("VLAN 10") && firewallHtml.includes("VLAN 30"), "la matrice de flux ne s'affiche pas");
  assert(firewallHtml.includes("Aucun pare-feu physique"), "la page pare-feu se présente comme déployée");
  assert(!firewallHtml.includes("Nouveau flux"), "le lecteur voit la création de flux");
  const adminFirewall = await fetch(`${webBase}/firewall`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminFirewallHtml = await adminFirewall.text();
  assert(adminFirewall.status === 200 && adminFirewallHtml.includes("Nouveau flux"), "l'administrateur ne voit pas la création de flux");
  const topologyPage = await fetch(`${webBase}/topology`, { headers: cookieHeader });
  const topologyHtml = await topologyPage.text();
  assert(topologyPage.status === 200 && topologyHtml.includes("core-paris") && topologyHtml.includes("sw-access-a") && topologyHtml.includes("Gi0/4") && topologyHtml.includes("Internet") && topologyHtml.includes("Simulation"), "la topologie ne montre pas l'inventaire");
  assert(topologyHtml.includes("Trafic non disponible") && topologyHtml.includes("LLDP") && topologyHtml.includes("Zoom avant") && topologyHtml.includes("Recherche"), "les commandes de topologie sont absentes");
  assert(topologyHtml.includes("ne sont pas des équipements réels"), "la page présente Internet comme un équipement réel");
  assert(!topologyHtml.includes("Ajouter Internet"), "le lecteur peut ajouter un nœud");
  const adminTopology = await fetch(`${webBase}/topology`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminTopologyHtml = await adminTopology.text();
  assert(adminTopology.status === 200 && adminTopologyHtml.includes("Ajouter Internet"), "l'administrateur ne peut pas ajouter Internet");
  const monitoringPage = await fetch(`${webBase}/monitoring`, { headers: cookieHeader });
  const monitoringHtml = await monitoringPage.text();
  assert(monitoringPage.status === 200 && monitoringHtml.includes("pc-accueil") && monitoringHtml.includes("DEVICE_DOWN") && monitoringHtml.includes("eth0") && monitoringHtml.includes("Aucun équipement réel"), "le tableau de supervision ne s'affiche pas");
  assert(monitoringHtml.includes("En ligne") && monitoringHtml.includes("Utilisation DHCP") && monitoringHtml.includes("ICMP"), "les indicateurs de supervision sont absents");
  assert(!monitoringHtml.includes("Nouvelle cible"), "le lecteur peut ajouter une cible");
  const adminMonitoring = await fetch(`${webBase}/monitoring`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminMonitoringHtml = await adminMonitoring.text();
  assert(adminMonitoring.status === 200 && adminMonitoringHtml.includes("Nouvelle cible"), "l'administrateur ne peut pas ajouter une cible");
  const discoveryPage = await fetch(`${webBase}/discovery`, { headers: cookieHeader });
  const discoveryHtml = await discoveryPage.text();
  assert(discoveryPage.status === 200 && discoveryHtml.includes("sw-nouveau") && discoveryHtml.includes("DISCOVERED") && discoveryHtml.includes("CONFLICT") && discoveryHtml.includes("Aucun équipement réel"), "le dossier de découverte ne s'affiche pas");
  assert(discoveryHtml.includes("Revue") && discoveryHtml.includes("Approbation") && discoveryHtml.includes("SSH") && discoveryHtml.includes("LLDP"), "le workflow de découverte est absent");
  assert(!discoveryHtml.includes("Lancer la découverte"), "le lecteur peut lancer une découverte");
  const adminDiscovery = await fetch(`${webBase}/discovery`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminDiscoveryHtml = await adminDiscovery.text();
  assert(adminDiscovery.status === 200 && adminDiscoveryHtml.includes("Lancer la découverte") && adminDiscoveryHtml.includes("Passer en revue"), "l'administrateur ne peut pas lancer la revue");
  const automationPage = await fetch(`${webBase}/automation`, { headers: cookieHeader });
  const automationHtml = await automationPage.text();
  assert(automationPage.status === 200 && automationHtml.includes("Route prévue") && automationHtml.includes("core-paris") && automationHtml.includes("Aucune configuration n'est envoyée"), "le moteur d'automatisation ne s'affiche pas");
  assert(automationHtml.includes("Essai à blanc") && automationHtml.includes("Ansible") && automationHtml.includes("API constructeur") && automationHtml.includes("autorisation explicite"), "le workflow d'automatisation est absent");
  assert(!automationHtml.includes("Nouveau modèle") && !automationHtml.includes("Valider"), "le lecteur peut lancer un travail");
  const adminAutomation = await fetch(`${webBase}/automation`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminAutomationHtml = await adminAutomation.text();
  assert(adminAutomation.status === 200 && adminAutomationHtml.includes("Nouveau modèle") && adminAutomationHtml.includes("Valider"), "l'administrateur ne peut pas valider un travail");
  const changesPage = await fetch(`${webBase}/changes`, { headers: cookieHeader });
  const changesHtml = await changesPage.text();
  assert(changesPage.status === 200 && changesHtml.includes("Route de secours") && changesHtml.includes("core-paris") && changesHtml.includes("n'est lue ni envoyée"), "la gestion des changements ne s'affiche pas");
  assert(changesHtml.includes("Sauvegarde") && changesHtml.includes("Rollback") && changesHtml.includes("Incident") && changesHtml.includes("Ancienne configuration") && changesHtml.includes("127.0.0.1"), "le journal de changement est absent");
  assert(!changesHtml.includes("Nouvelle demande") && !changesHtml.includes("Sauvegarder"), "le lecteur peut ouvrir une demande");
  const adminChanges = await fetch(`${webBase}/changes`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminChangesHtml = await adminChanges.text();
  assert(adminChanges.status === 200 && adminChangesHtml.includes("Nouvelle demande") && adminChangesHtml.includes("Sauvegarder"), "l'administrateur ne peut pas sauvegarder");
  const diagnosticsPage = await fetch(`${webBase}/diagnostics`, { headers: cookieHeader });
  const diagnosticsHtml = await diagnosticsPage.text();
  assert(diagnosticsPage.status === 200 && diagnosticsHtml.includes("pc-accueil") && diagnosticsHtml.includes("FACT") && diagnosticsHtml.includes("OBSERVATION") && diagnosticsHtml.includes("POSSIBLE CAUSE") && diagnosticsHtml.includes("RECOMMENDED CHECK") && diagnosticsHtml.includes("n'est interrogé"), "le centre de diagnostic ne s'affiche pas");
  assert(diagnosticsHtml.includes("Client sans IP") && diagnosticsHtml.includes("DHCP Server"), "le guide n'est pas affiché");
  assert(!diagnosticsHtml.includes("Lancer la sonde"), "le lecteur lance une sonde");
  const adminDiagnostics = await fetch(`${webBase}/diagnostics`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminDiagnosticsHtml = await adminDiagnostics.text();
  assert(adminDiagnostics.status === 200 && adminDiagnosticsHtml.includes("Lancer la sonde"), "l'administrateur ne peut pas lancer une sonde");
  const labPage = await fetch(`${webBase}/lab`, { headers: cookieHeader });
  const labHtml = await labPage.text();
  assert(labPage.status === 200 && labHtml.includes("lab-router") && labHtml.includes("lab-client") && labHtml.includes("VLAN") && labHtml.includes("CONNECTIVITY") && labHtml.includes("isolé"), "le laboratoire ne s'affiche pas");
  assert(labHtml.includes("LAB") && labHtml.includes("STAGING") && labHtml.includes("PRODUCTION") && labHtml.includes("DEV"), "les environnements sont absents");
  assert(!labHtml.includes("Créer la fabrique") && !labHtml.includes("Préparer la promotion"), "le lecteur peut créer ou promouvoir");
  const adminLab = await fetch(`${webBase}/lab`, { headers: { cookie: adminCookie.split(";")[0] } });
  const adminLabHtml = await adminLab.text();
  assert(adminLab.status === 200 && adminLabHtml.includes("Préparer la promotion"), "l'administrateur ne peut pas préparer une promotion");
  const documentationPage = await fetch(`${webBase}/documentation`, { headers: cookieHeader });
  const documentationHtml = await documentationPage.text();
  assert(documentationPage.status === 200 && documentationHtml.includes("Documentation") && documentationHtml.includes("Aucun équipement réel") && documentationHtml.includes("Matrice VLAN") && documentationHtml.includes("Plan IP") && documentationHtml.includes("Exporter JSON"), "la documentation ne s'affiche pas");
  assert(documentationHtml.includes("VLAN") && documentationHtml.includes("IPAM") && documentationHtml.includes("core-paris"), "les relations ou l'inventaire documentés sont absents");
});

if (failures.length) {
  console.error(`\n${failures.length} vérification(s) en échec`);
  process.exit(1);
}

console.log("\nToutes les vérifications sont passées.");

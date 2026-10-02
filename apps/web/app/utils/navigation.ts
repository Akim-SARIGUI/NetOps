export type NavItem = {
  to: string;
  label: string;
  icon: string;
  match?: string;
  auditOnly?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "layout",
    items: [{ to: "/dashboard", label: "Dashboard", icon: "gauge", match: "/dashboard" }],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    icon: "server",
    items: [
      { to: "/inventory", label: "Équipements", icon: "cpu", match: "/inventory" },
      { to: "/switching", label: "VLAN / Commutation", icon: "layers", match: "/switching" },
      { to: "/ipam", label: "IPAM", icon: "network", match: "/ipam" },
      { to: "/topology", label: "Topologie", icon: "share", match: "/topology" },
    ],
  },
  {
    id: "services",
    label: "Services réseau",
    icon: "globe",
    items: [
      { to: "/dhcp", label: "DHCP", icon: "wifi", match: "/dhcp" },
      { to: "/dns", label: "DNS", icon: "book", match: "/dns" },
      { to: "/routing", label: "Routage", icon: "route", match: "/routing" },
    ],
  },
  {
    id: "security",
    label: "Security",
    icon: "shield",
    items: [{ to: "/firewall", label: "Pare-feu / ACL", icon: "shield", match: "/firewall" }],
  },
  {
    id: "operations",
    label: "Operations",
    icon: "activity",
    items: [
      { to: "/monitoring", label: "Supervision", icon: "activity", match: "/monitoring" },
      { to: "/discovery", label: "Découverte", icon: "radar", match: "/discovery" },
      { to: "/diagnostics", label: "Diagnostic", icon: "stethoscope", match: "/diagnostics" },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    icon: "spark",
    items: [
      { to: "/automation", label: "Automatisation", icon: "spark", match: "/automation" },
      { to: "/changes", label: "Changements", icon: "git", match: "/changes" },
      { to: "/lab", label: "Laboratoire", icon: "flask", match: "/lab" },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    icon: "file",
    items: [
      { to: "/documentation", label: "Documentation", icon: "file", match: "/documentation" },
      { to: "/audit", label: "Journal", icon: "scroll", match: "/audit", auditOnly: true },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    icon: "settings",
    items: [{ to: "/", label: "Organisations", icon: "building", match: "/organizations" }],
  },
];

export function pageTitleForPath(path: string) {
  if (path.startsWith("/dashboard")) return "Dashboard";
  if (path === "/" || path.startsWith("/organizations")) return "Organisations";
  if (path.startsWith("/inventory") || path.startsWith("/devices")) return "Inventaire";
  if (path.startsWith("/switching") || path.startsWith("/vlans") || path.startsWith("/switches")) return "Commutation";
  if (path.startsWith("/ipam") || path.startsWith("/subnets") || path.startsWith("/networks")) return "Adressage";
  if (path.startsWith("/topology")) return "Topologie";
  if (path.startsWith("/dhcp")) return "DHCP";
  if (path.startsWith("/dns")) return "DNS";
  if (path.startsWith("/routing")) return "Routage";
  if (path.startsWith("/firewall")) return "Pare-feu";
  if (path.startsWith("/monitoring")) return "Supervision";
  if (path.startsWith("/discovery")) return "Découverte";
  if (path.startsWith("/diagnostics")) return "Diagnostic";
  if (path.startsWith("/automation")) return "Automatisation";
  if (path.startsWith("/changes")) return "Changements";
  if (path.startsWith("/lab")) return "Laboratoire";
  if (path.startsWith("/documentation")) return "Documentation";
  if (path.startsWith("/audit")) return "Journal";
  if (path.startsWith("/sites") || path.startsWith("/buildings") || path.startsWith("/rooms") || path.startsWith("/racks")) return "Sites";
  return "NetOps";
}

export function isNavActive(path: string, item: NavItem) {
  if (item.to === "/") return path === "/" || path.startsWith("/organizations");
  if (item.match) return path === item.to || path.startsWith(item.match);
  return path === item.to || path.startsWith(`${item.to}/`);
}

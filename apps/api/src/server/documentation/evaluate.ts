export const DOCUMENTATION_NOTICE =
  "Documentation générée depuis l'inventaire NetOps. Aucun équipement réel n'est interrogé.";

export const SECTIONS = [
  "NETWORK",
  "INVENTORY",
  "IP_PLAN",
  "VLAN_MATRIX",
  "SWITCH_PORT_MATRIX",
  "DHCP",
  "DNS",
  "ROUTING",
  "FIREWALL_MATRIX",
  "TOPOLOGY",
  "CONFIGURATION_HISTORY",
] as const;

export const FORMATS = ["JSON", "CSV", "PDF"] as const;

export type SectionId = (typeof SECTIONS)[number];
export type ExportFormat = (typeof FORMATS)[number];

export type DocRow = Record<string, string | number | boolean | null>;

export type DocSection = {
  id: SectionId;
  title: string;
  description: string;
  columns: string[];
  rows: DocRow[];
};

export const SECTION_META: Record<SectionId, { title: string; description: string }> = {
  NETWORK: {
    title: "Documentation réseau",
    description: "Sites et environnements de l'organisation, séparés de la production quand ils sont LAB ou DEV.",
  },
  INVENTORY: {
    title: "Inventaire",
    description: "Équipements enregistrés et leurs interfaces.",
  },
  IP_PLAN: {
    title: "Plan IP",
    description: "Réseaux, sous-réseaux et adresses liées aux VLAN.",
  },
  VLAN_MATRIX: {
    title: "Matrice VLAN",
    description: "VLAN du site et sous-réseaux associés.",
  },
  SWITCH_PORT_MATRIX: {
    title: "Matrice des ports de commutation",
    description: "Ports d'accès et trunks, VLAN et équipements reliés.",
  },
  DHCP: {
    title: "Documentation DHCP",
    description: "Serveurs, scopes, pools et relais simulés.",
  },
  DNS: {
    title: "Documentation DNS",
    description: "Serveurs, zones et enregistrements locaux.",
  },
  ROUTING: {
    title: "Documentation de routage",
    description: "Interfaces de couche 3 et routes prévues.",
  },
  FIREWALL_MATRIX: {
    title: "Matrice de pare-feu",
    description: "Zones et flux prévus entre zones.",
  },
  TOPOLOGY: {
    title: "Topologie",
    description: "Liens d'inventaire et marqueurs. Pas de découverte temps réel.",
  },
  CONFIGURATION_HISTORY: {
    title: "Historique de configuration",
    description: "Versions et demandes de changement enregistrées localement.",
  },
};

export function sectionTitle(id: SectionId) {
  return SECTION_META[id].title;
}

export function toCsv(sections: readonly DocSection[]) {
  const blocks: string[] = [];
  for (const section of sections) {
    blocks.push(`# ${section.title}`);
    blocks.push(section.columns.map(csvEscape).join(","));
    for (const row of section.rows) {
      blocks.push(section.columns.map((column) => csvEscape(stringify(row[column]))).join(","));
    }
    blocks.push("");
  }
  return blocks.join("\n");
}

export function toJsonDocument(input: {
  notice: string;
  organization: { id: string; name: string; slug: string };
  generatedAt: string;
  siteId: string | null;
  sections: readonly DocSection[];
  relations: Array<{ from: string; to: string; rule: string }>;
}) {
  return JSON.stringify(
    {
      notice: input.notice,
      generatedAt: input.generatedAt,
      organization: input.organization,
      siteId: input.siteId,
      relations: input.relations,
      sections: input.sections,
    },
    null,
    2,
  );
}

export function toPdf(input: {
  title: string;
  notice: string;
  generatedAt: string;
  organizationName: string;
  sections: readonly DocSection[];
}) {
  const lines = [
    input.title,
    input.organizationName,
    input.generatedAt,
    input.notice,
    "",
    ...input.sections.flatMap((section) => {
      const rows = section.rows.slice(0, 40).map((row) =>
        section.columns.map((column) => `${column}=${stringify(row[column])}`).join(" | "),
      );
      return [`## ${section.title}`, section.description, ...rows, ""];
    }),
  ];
  return buildPdf(lines);
}

export function moduleRelations() {
  return [
    { from: "VLAN", to: "IPAM", rule: "Un sous-réseau est rattaché à un VLAN du même site." },
    { from: "IPAM", to: "DHCP", rule: "Un scope DHCP couvre un sous-réseau d'adressage." },
    { from: "IPAM", to: "DNS", rule: "Une zone inverse peut être liée à un sous-réseau." },
    { from: "VLAN", to: "Commutation", rule: "Les ports d'accès et trunks référencent des VLAN du site." },
    { from: "VLAN", to: "Routage", rule: "Les SVI et sous-interfaces portent un VLAN et un sous-réseau." },
    { from: "VLAN", to: "Pare-feu", rule: "Les zones de sécurité regroupent des VLAN." },
    { from: "Inventaire", to: "Topologie", rule: "Les liens d'inventaire relient des équipements enregistrés." },
    { from: "Inventaire", to: "Supervision", rule: "Une cible de supervision pointe vers un équipement." },
    { from: "Inventaire", to: "Automatisation", rule: "Un travail d'automatisation cible un équipement, sans envoi réel." },
    { from: "Inventaire", to: "Changements", rule: "Une demande de changement conserve versions et journal locaux." },
    { from: "LAB", to: "STAGING", rule: "Une promotion LAB exige validation avant STAGING, puis PRODUCTION." },
    { from: "Découverte", to: "Inventaire", rule: "L'import crée un équipement PLANNED ; la production exige une confirmation." },
  ];
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function stringify(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function buildPdf(lines: string[]) {
  const sanitized = lines.map((line) => line.replace(/[^\x09\x20-\x7E\u00C0-\u017F]/g, "?").slice(0, 110));
  const contentLines = ["BT", "/F1 10 Tf", "50 800 Td", "14 TL"];
  for (const [index, line] of sanitized.entries()) {
    const text = escapePdf(line);
    if (index === 0) contentLines.push(`(${text}) Tj`);
    else contentLines.push(`T* (${text}) Tj`);
  }
  contentLines.push("ET");
  const stream = contentLines.join("\n");
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${Buffer.byteLength(stream, "utf8")} >>stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function escapePdf(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

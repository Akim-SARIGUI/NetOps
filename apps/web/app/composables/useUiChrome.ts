export type UiTheme = "light" | "dark";

function readStored(key: string) {
  if (!import.meta.client) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useUiChrome() {
  const theme = useState<UiTheme>("netops-theme", () => "light");
  const sidebarCollapsed = useState("netops-sidebar-collapsed", () => false);
  const mobileOpen = useState("netops-sidebar-mobile", () => false);
  const openGroups = useState<Record<string, boolean>>("netops-nav-groups", () => ({
    overview: true,
    infrastructure: true,
    services: true,
    security: true,
    operations: true,
    automation: true,
    governance: true,
    administration: true,
  }));

  function applyTheme(value: UiTheme) {
    theme.value = value;
    if (import.meta.client) {
      document.documentElement.setAttribute("data-theme", value);
      localStorage.setItem("netops-theme", value);
    }
  }

  function toggleTheme() {
    applyTheme(theme.value === "dark" ? "light" : "dark");
  }

  function toggleSidebar() {
    if (import.meta.client && window.matchMedia("(max-width: 960px)").matches) {
      mobileOpen.value = !mobileOpen.value;
      return;
    }
    sidebarCollapsed.value = !sidebarCollapsed.value;
    if (import.meta.client) localStorage.setItem("netops-sidebar-collapsed", sidebarCollapsed.value ? "1" : "0");
  }

  function closeMobile() {
    mobileOpen.value = false;
  }

  function toggleGroup(id: string) {
    openGroups.value = { ...openGroups.value, [id]: !openGroups.value[id] };
  }

  function hydrate() {
    if (!import.meta.client) return;
    const storedTheme = readStored("netops-theme");
    if (storedTheme === "dark" || storedTheme === "light") applyTheme(storedTheme);
    else applyTheme("light");
    sidebarCollapsed.value = readStored("netops-sidebar-collapsed") === "1";
  }

  return {
    theme,
    sidebarCollapsed,
    mobileOpen,
    openGroups,
    applyTheme,
    toggleTheme,
    toggleSidebar,
    closeMobile,
    toggleGroup,
    hydrate,
  };
}

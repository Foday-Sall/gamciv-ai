const COUNCIL_LABELS: Record<string, string> = {
  banjul: "Banjul City Council (Banjul)",
  kanifing: "Kanifing Municipal Council (Kanifing)",
  brikama: "Brikama Area Council (West Coast Region)",
  kerewan: "Kerewan Area Council (North Bank Region)",
  mansakonko: "Mansakonko Area Council (Lower River Region)",
  janjanbureh: "Janjanbureh Area Council (Central River Region - South)",
  kuntaur: "Kuntaur Area Council (Central River Region - North)",
  basse: "Basse Area Council (Upper River Region)",
}

export function councilAreaLabel(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const normalized = value.trim().toLowerCase().replaceAll(" ", "_")
  return COUNCIL_LABELS[normalized] ?? value.trim().replaceAll("_", " ")
}

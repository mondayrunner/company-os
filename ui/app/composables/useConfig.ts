/** The public config, fetched once per session: name, locale, nav, live kinds. */
export function useConfig() {
  const { data } = useLazyFetch<any>("/api/config", { server: false, key: "config" })
  const cfg = computed(() => (data.value?.ok ? data.value.data : { name: "", language: "en", locale: "en-GB", title: "company-os", logo: null, nav: [], panels: [], kinds: [] }))
  const locale = computed(() => cfg.value.locale)
  const fmt = {
    date: (d: string | null | undefined, opt: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => (d ? new Date(d).toLocaleDateString(locale.value, opt) : ""),
    time: (d: string | null | undefined) => (d ? new Date(d).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit" }) : ""),
    day: (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(locale.value, { weekday: "short", day: "numeric", month: "short" }) : ""),
    month: (m: string | null | undefined) => (m ? new Date(`${m}-01`).toLocaleDateString(locale.value, { month: "short" }) : ""),
    money: (n: number | null | undefined, currency = "EUR") => (n == null ? "—" : new Intl.NumberFormat(locale.value, { style: "currency", currency, maximumFractionDigits: 0 }).format(n)),
    when: (iso?: string | null) => {
      if (!iso) return ""
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return iso
      const t = d.toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit" })
      return new Date().toDateString() === d.toDateString() ? `today ${t}` : `${d.toLocaleDateString(locale.value, { day: "numeric", month: "short" })} ${t}`
    },
  }
  return { cfg, locale, fmt }
}

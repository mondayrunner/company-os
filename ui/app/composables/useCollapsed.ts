// Remembers which groups are collapsed across reloads; otherwise every refresh reopens everything.
export function useCollapsed(name: string) {
  const closed = useState<string[]>(`collapsed-${name}`, () => [])
  onMounted(() => { try { closed.value = JSON.parse(localStorage.getItem(`collapsed-${name}`) ?? "[]") } catch {} })
  function toggle(key: string) {
    closed.value = closed.value.includes(key) ? closed.value.filter((s) => s !== key) : [...closed.value, key]
    localStorage.setItem(`collapsed-${name}`, JSON.stringify(closed.value))
  }
  return { isClosed: (key: string) => closed.value.includes(key), toggle }
}

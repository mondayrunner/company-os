<script setup lang="ts">
// [[path]] and [[live:kind @ time]] become source chips; the rest is light markdown.
const props = defineProps<{ text: string }>()
const html = computed(() => {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  // De slotregel met bronnen staat al als eigen blok onder het antwoord; twee
  // keer dezelfde lijst leest als een fout.
  let h = esc((props.text ?? "").replace(/\n+(Sources|Bronnen):[^\n]*$/i, ""))
  h = h.replace(/\[\[(live:[^\]]+)\]\]/g, (_m, l) => `<span class="source" title="${l}">${l.replace(/^live:/, "live · ")}</span>`)
  h = h.replace(/\[\[([^\]|#:]+?)(?::([\d-]+))?\]\]/g, (_m, p, r) => `<span class="source" title="${p}${r ? ":" + r : ""}">${p.split("/").pop()}${r ? ":" + r : ""}</span>`)
  // Ook een kaal pad met regelnummer, want dat schrijft het model er soms van.
  h = h.replace(/(^|[\s(])([\w./-]+\.md(?::[\d-]+)?)(?=[\s).,;]|$)/g, (_m, pre, ref) => `${pre}<span class="source">${ref.split("/").pop()}</span>`)
  h = h.replace(/^### (.+)$/gm, "<h4>$1</h4>").replace(/^## (.+)$/gm, "<h3>$1</h3>").replace(/^# (.+)$/gm, "<h3>$1</h3>")
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>")
  h = h.replace(/^\|(.+)\|\s*$/gm, (row) => (/^\|[\s:|-]+\|$/.test(row.trim()) ? "" : `<tr>${row.trim().slice(1, -1).split("|").map((c) => `<td>${c.trim()}</td>`).join("")}</tr>`)).replace(/((?:<tr>.*<\/tr>\n?)+)/g, "<table>$1</table>")
  h = h.replace(/^(?:- |\* |\d+\. )(.+)$/gm, "<li>$1</li>").replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
  return h.split(/\n{2,}/).map((b) => (/^<(h3|h4|ul|table)/.test(b.trim()) ? b : `<p>${b.replace(/\n/g, "<br>")}</p>`)).join("\n")
})
</script>
<template><div class="answer" v-html="html" /></template>

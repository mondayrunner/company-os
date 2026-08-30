/**
 * Waiting, with a face.
 *
 * A spinner that only turns says nothing. A word that changes, a counter that
 * runs, and now and then a line about what is happening, says: I am alive, and
 * this is how long it takes. The words are the ones Claude Code uses. A wink,
 * and they work because they promise nothing.
 */
export const WAITING_WORDS = [
  "Accomplishing", "Actualizing", "Architecting", "Baking", "Beaming", "Befuddling", "Billowing", "Blanching",
  "Bloviating", "Boogieing", "Boondoggling", "Booping", "Bootstrapping", "Brewing", "Burrowing", "Calculating",
  "Canoodling", "Caramelizing", "Cascading", "Catapulting", "Cerebrating", "Channeling", "Choreographing",
  "Churning", "Clauding", "Clobbering", "Coalescing", "Cogitating", "Combobulating", "Composing", "Computing",
  "Concocting", "Considering", "Contemplating", "Cooking", "Crafting", "Crunching", "Crystallizing", "Cultivating",
  "Deciphering", "Deliberating", "Discombobulating", "Dithering", "Doodling", "Drizzling", "Elucidating",
  "Embellishing", "Enchanting", "Envisioning", "Fermenting", "Finagling", "Flibbertigibbeting", "Flummoxing",
  "Fluttering", "Forging", "Frolicking", "Gallivanting", "Galloping", "Garnishing", "Germinating", "Gesticulating",
  "Grooving", "Harmonizing", "Hatching", "Herding", "Honking", "Hullaballooing", "Hyperspacing", "Ideating",
  "Imagining", "Improvising", "Incubating", "Inferring", "Infusing", "Interleaving", "Jitterbugging", "Julienning",
  "Kneading", "Leavening", "Levitating", "Lollygagging", "Manifesting", "Marinating", "Meandering", "Metamorphosing",
  "Moonwalking", "Moseying", "Mulling", "Mustering", "Nebulizing", "Noodling", "Nucleating", "Orbiting",
  "Orchestrating", "Osmosing", "Perambulating", "Percolating", "Perusing", "Philosophising", "Photosynthesizing",
  "Pollinating", "Pondering", "Pontificating", "Pouncing", "Precipitating", "Prestidigitating", "Proofing",
  "Propagating", "Puttering", "Quantumizing", "Razzmatazzing", "Recombobulating", "Reticulating", "Roaming",
  "Ruminating", "Scampering", "Schlepping", "Scurrying", "Seasoning", "Shenaniganing", "Shimmying", "Simmering",
  "Skedaddling", "Slithering", "Smooshing", "Spelunking", "Sprouting", "Stewing", "Sublimating", "Swirling",
  "Swooping", "Symbioting", "Synthesizing", "Tempering", "Thinking", "Tinkering", "Tomfoolering", "Transfiguring",
  "Transmuting", "Undulating", "Unfurling", "Unravelling", "Waddling", "Wandering", "Whatchamacalliting",
  "Whirlpooling", "Whirring", "Whisking", "Wibbling", "Wrangling", "Zesting", "Zigzagging",
]

export function useWaiting(active: Ref<boolean>, { every = 4000 } = {}) {
  const word = ref(WAITING_WORDS[Math.floor(Math.random() * WAITING_WORDS.length)])
  const seconds = ref(0)
  let wordTimer: any = null
  let clock: any = null

  function start() {
    seconds.value = 0
    word.value = WAITING_WORDS[Math.floor(Math.random() * WAITING_WORDS.length)]
    clock = setInterval(() => seconds.value++, 1000)
    wordTimer = setInterval(() => {
      let next = word.value
      while (next === word.value) next = WAITING_WORDS[Math.floor(Math.random() * WAITING_WORDS.length)]
      word.value = next
    }, every)
  }
  function stop() { clearInterval(clock); clearInterval(wordTimer); clock = wordTimer = null }

  watch(active, (on) => (on ? start() : stop()), { immediate: true })
  onBeforeUnmount(stop)

  const elapsed = computed(() => (seconds.value < 60 ? `${seconds.value}s` : `${Math.floor(seconds.value / 60)}m ${String(seconds.value % 60).padStart(2, "0")}s`))
  return { word, seconds, elapsed }
}

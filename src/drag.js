// Drag & Drop von Karten zwischen Sammlung und Decks
const TYPE = 'application/x-mtg-card'

export function dragProps(payload) {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(TYPE, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'move'
      if (payload.multi) {
        // Eigenes Zieh-Bild: „N Karten“
        const g = document.createElement('div')
        g.className = 'drag-ghost'
        g.textContent = `${payload.multi.length} Karten`
        document.body.appendChild(g)
        e.dataTransfer.setDragImage(g, 20, 20)
      }
      document.body.classList.add('dragging')
    },
    onDragEnd: () => { document.body.classList.remove('dragging'); document.querySelectorAll('.drag-ghost').forEach((g) => g.remove()) },
  }
}

export function readDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData(TYPE)) } catch { return null }
}

// Drag & Drop von Karten zwischen Sammlung und Decks
const TYPE = 'application/x-mtg-card'

export function dragProps(payload) {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(TYPE, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'move'
      document.body.classList.add('dragging')
    },
    onDragEnd: () => document.body.classList.remove('dragging'),
  }
}

export function readDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData(TYPE)) } catch { return null }
}

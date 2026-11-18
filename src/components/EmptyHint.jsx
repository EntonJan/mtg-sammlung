// „So geht’s“-Kasten für leere Seiten: kurze nummerierte Schritte statt nur Text
export default function EmptyHint({ title = 'So geht’s', steps, children }) {
  return (
    <div className="empty-hint">
      <div className="eh-title">◆ {title} ◆</div>
      <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {children}
    </div>
  )
}

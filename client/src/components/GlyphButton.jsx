export default function GlyphButton({ glyph, label, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`glyph-button ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

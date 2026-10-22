export function PreviewDataWarning() {
  return (
    <div className="bg-amber-500 text-black text-center text-xs sm:text-sm font-medium px-3 sm:px-4 py-1.5 sm:py-2">
      {/* One line on phones: the full sentence took ~15% of a 375px screen. */}
      <span className="sm:hidden">Preview: base de datos compartida, no uses datos reales.</span>
      <span className="hidden sm:inline">
        Preview de Betsy v2: los cambios se escriben en la base de datos compartida. No uses datos de clientes reales para pruebas destructivas.
      </span>
    </div>
  );
}

import { SENSENOVA_U1_SIZES } from '../lib/imageModules'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

export default function SenseNovaSizeModal({
  currentSize,
  onSelect,
  onClose,
}: {
  currentSize: string
  onSelect: (size: string) => void
  onClose: () => void
}) {
  usePreventBackgroundScroll(true)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} aria-label="关闭" />
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">U1 信息图尺寸</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">日日新 U1 Fast 官方支持的固定尺寸</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 dark:hover:bg-white/[0.06]" aria-label="关闭">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
          {SENSENOVA_U1_SIZES.map((size) => {
            const [width, height] = size.split('x').map(Number)
            const label = width === height ? '方形' : width > height ? '横向' : '竖向'
            return (
              <button
                key={size}
                onClick={() => {
                  onSelect(size)
                  onClose()
                }}
                className={`rounded-xl border px-3 py-3 text-left transition ${currentSize === size
                  ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300'
                  : 'border-gray-200/70 bg-white/60 text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="font-mono text-sm font-medium">{size}</div>
                <div className="mt-1 text-[11px] opacity-60">{label}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

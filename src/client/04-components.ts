// ------------------------------------------------------------- components
function GaugeIcon(props: { size?: number }) {
  const size = props?.size || 16
  return h(
    'svg',
    { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
    h('path', {
      d: 'M4 17a8 8 0 0 1 16 0',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
    }),
    h('path', { d: 'M12 17l4.5-5.5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
    h('circle', { cx: 12, cy: 17, r: 1.6, fill: 'currentColor' }),
  )
}

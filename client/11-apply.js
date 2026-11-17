return {
  inject: ['slots', 'locale'],
  apply(ctx) {
    env.locale = ctx.locale
    ctx.slots.inject('conversation.chat.turnTail', () =>
      ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'skill-eval-turn', order: 30 }, TurnSkillCard),
    )
    // Board: sidebar panel icon + the main panel it addresses (same pattern
    // as the context plugin). The icon label follows the page language.
    const panelLabel = () => {
      let active
      try {
        const snapshot = ctx.locale && typeof ctx.locale.getSnapshot === 'function' ? ctx.locale.getSnapshot() : null
        active = snapshot && snapshot.active ? String(snapshot.active) : ''
      } catch {
        // fall back to the browser language below
      }
      if (!active && typeof navigator !== 'undefined') active = String(navigator.language || '')
      return /^zh/i.test(active) ? '技能评测' : 'Skill eval'
    }
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: 'skill-eval', order: 40, label: panelLabel }, PanelIcon),
    )
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'skill-eval' }, BoardPanel))
    // Two human entry points by design: the in-conversation strip (below)
    // and one board row in the session header's More menu. Settings live in
    // the plugin's own row config page, not a separate section.
    if (ENABLE_POPUP) {
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'skill-eval-open', order: 30, label: panelLabel },
          FooterAction,
        ),
      )
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'skill-eval-modal', order: 900 }, ReportOverlay),
      )
    }
    // Settings: the bundle's own config page (Settings → Plugins → this
    // bundle), keyed by the package name — the same seat the context plugin
    // uses for its settings.
    ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-skill-eval' }, RowConfig),
    )
  },
}

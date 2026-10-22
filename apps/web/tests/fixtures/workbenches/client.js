/** Local workbench provider with observable business state and an embedded report. */
window.__ModuleLoader__.load({
  id: '@fixture/web-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    function Panel() {
      const [note, setNote] = React.useState('')
      return h('section', { 'data-workbench-fixture': '', 'aria-label': 'Fixture workbench' },
        h('label', null, 'Business note', h('input', { value: note, onChange: event => setNote(event.target.value) })),
        h('iframe', { title: 'Workbench report', srcDoc: '<h1>Workbench report ready</h1>' }))
    }
    return {
      inject: ['desktopWorkbenches'],
      apply(ctx) {
        ctx.effect(() => ctx.desktopWorkbenches.register({
          title: 'Fixture Workbench', titleEn: 'Fixture Workbench',
          description: 'Local business panel fixture', repository: 'https://github.com/fixture/web-workbench',
          panelTitle: 'Business panel', initialization: 'manual',
        }, Panel))
      },
    }
  },
})

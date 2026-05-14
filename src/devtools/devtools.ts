chrome.devtools.panels.create(
  'Moo',
  '',
  'src/devtools/panel.html',
  () => {
    console.log('[Moo] devtools panel registered')
  }
)
